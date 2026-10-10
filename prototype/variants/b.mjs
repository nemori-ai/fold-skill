import {
  escapeHTML as esc, formatDate, formatTime, kindLabel,
  getItem, getLayer, colorFor, detailHTML, currentAsk, feedbackTrail,
} from './shared.mjs?v=feedback-loop-1';
import { stableOrder, layoutSection, bandPath, centerPath, labelPositions } from './b-layout.mjs?v=b-polish-1';
import { createTimeMotion } from './b-motion.mjs?v=b-polish-1';

const CHANGE_NAMES = { added: '新增事项', updated: '内容更新', withdrawn: '已撤下',
  restored: '恢复事项', merged: '已合并', annotations_changed: '批注变化' };
// Only expectations registered with a feedback path (frame.asks) get these words.
const EXPECT = { decide: '需要你决定', input: '需要你提供', act: '需要你去做' };
const MEANING = { decide: '回应决定', input: '提供输入', act: '报告已处理', ack: '已阅', snooze: '稍后提醒' };
const VIA = { reply: '回复消息', button: '登记的按钮' };
const SVG = 'http://www.w3.org/2000/svg';
const AXIS_HEIGHT = 40;
const stamp = value => `${formatDate(value)} ${formatTime(value)}`;
const frameShort = (frame, index, total) => `${String(index + 1).padStart(2, '0')} / ${total} · ${stamp(frame.at)}`;
const frameName = (frame, index) => `${String(index + 1).padStart(2, '0')} · ${stamp(frame.at)} · ${frame.title}`;
const center = point => point.y + point.height / 2;
const isReview = frame => frame?.signal?.type === 'review';
let mountNumber = 0;

function explicitMerges(records, layerId) {
  const links = [];
  for (let index = 1; index < records.length; index += 1) {
    const before = getLayer(records[index - 1].state, layerId);
    const after = getLayer(records[index].state, layerId);
    for (const source of before.items) {
      const historical = getItem(records[index].state, source.id);
      const target = after.items.find(item => item.id === historical?.merged_into);
      if (historical?.status === 'merged' && target) links.push({ index, from: source.id, to: target.id, source, target });
    }
  }
  return links;
}

// The registered question a later feedback answers. Prefer the ask that was still
// valid for the version the person saw; otherwise the latest ask for that target.
function askBefore(records, frames, target, index) {
  if (index <= 0) return null;
  const valid = currentAsk({ index: index - 1, state: records[index - 1].state }, target);
  if (valid) return valid;
  for (let at = index - 1; at >= 0; at -= 1) if (frames[at].asks?.[target]) return { ...frames[at].asks[target], frameIndex: at };
  return null;
}
function anchorIn(state, id, visible) {
  let item = getItem(state, id); const seen = new Set();
  while (item && !visible.has(item.id) && item.parent_id && !seen.has(item.id)) { seen.add(item.id); item = getItem(state, item.parent_id); }
  return item && visible.has(item.id) ? item.id : null;
}
// Only explicit records: event.feedback links and event.reminder targets.
function loopMarks(records, frames, layerId) {
  const marks = [];
  frames.forEach((frame, index) => {
    const layer = getLayer(records[index].state, layerId);
    const visible = new Set(layer.items.map(item => item.id));
    const before = index > 0 ? getLayer(records[index - 1].state, layerId) : null;
    const visibleBefore = new Set(before?.items.map(item => item.id) ?? []);
    for (const event of frame.events) {
      const entries = [...(event.feedback || []).map(link => ({ link, target: link.target, kind: link.meaning === 'snooze' ? 'snooze' : 'answer' })),
        ...(event.reminder ? [{ target: event.reminder.target, kind: 'reminder' }] : [])];
      for (const entry of entries) {
        const anchor = anchorIn(records[index].state, entry.target, visible)
          ?? (index > 0 ? anchorIn(records[index - 1].state, entry.target, visibleBefore) : null);
        if (!anchor) continue;
        const ask = entry.kind === 'answer' ? askBefore(records, frames, entry.target, index) : null;
        const askAnchor = ask ? anchorIn(records[ask.frameIndex].state, entry.target,
          new Set(getLayer(records[ask.frameIndex].state, layerId).items.map(item => item.id))) : null;
        marks.push({ key: `${event.id}:${entry.target}:${entry.kind}`, index, event, ...entry, anchor,
          ask, askIndex: askAnchor === anchor ? ask.frameIndex : null,
          changes: records[index].diff.changes.filter(change => change.item === entry.target || change.item === anchor) });
      }
    }
  });
  return marks;
}
function markTitle(mark, frames, state) {
  const target = getItem(state, mark.target)?.title || mark.target;
  if (mark.kind === 'reminder') return `${stamp(mark.event.at)} 到点提醒：你 ${stamp(mark.event.reminder.requested_at)} 要求再看「${target}」，本轮按现在的事实重判`;
  if (mark.kind === 'snooze') return `${stamp(mark.event.at)} 你要求 ${stamp(mark.link.until)} 再提醒「${target}」；不是已阅，不改截止`;
  const asked = mark.ask ? `问（${stamp(frames[mark.ask.frameIndex].at)}）：${mark.ask.prompt}\n` : '';
  const after = mark.changes.length ? `本轮：${mark.changes.map(change => CHANGE_NAMES[change.type] || change.type).join('、')}` : '本轮状态未变';
  return `${asked}${stamp(mark.event.at)} 你${VIA[mark.link.via] ? `通过${VIA[mark.link.via]}` : ''}${MEANING[mark.link.meaning] || ''}${mark.link.value ? `「${mark.link.value}」` : ''}\n${after}`;
}

// Custom listbox (no native <select>): a button plus a fixed-position popup.
const selectHTML = (kind, label, options, value) => `<div class="b-select" data-b-select="${kind}"><button type="button" class="b-select-button" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(label)}"><span class="b-select-value">${esc(options[value]?.text ?? '')}</span><span class="b-select-caret" aria-hidden="true"></span></button><ul class="b-select-list" role="listbox" tabindex="-1" aria-label="${esc(label)}" hidden>${options.map((option, index) => `<li role="option" data-value="${option.value}" aria-selected="${index === value}" class="${option.className || ''}"><span>${esc(option.text)}</span>${option.note ? `<small>${esc(option.note)}</small>` : ''}</li>`).join('')}</ul></div>`;

export function mount(host, model) {
  host.classList.add('variant-b');
  const uid = `b${++mountNumber}`;
  const $ = selector => host.querySelector(selector);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 760px)');
  let current = model.snapshot(), range = 'recent', readerMode = 'overview';
  let hoveredId = null, focusedId = null, disposed = false, resizeFrame = null;
  let chartStamp = '', readerStamp = '', openSelect = null, dragging = false;
  const layerCache = new Map(), pathElements = new Map(), currentElements = new Map();
  const nodeElements = new Map(), mergeElements = new Map(), markElements = new Map();
  const cache = layerId => {
    const key = layerId ?? '__root__';
    if (!layerCache.has(key)) {
      const layers = current.records.map(record => getLayer(record.state, layerId));
      layerCache.set(key, { layers, order: stableOrder(layers), merges: explicitMerges(current.records, layerId),
        marks: loopMarks(current.records, current.frames, layerId) });
    }
    return layerCache.get(key);
  };
  const frameOptions = current.frames.map((frame, index) => ({ value: index, text: frameName(frame, index),
    note: isReview(frame) ? frame.signal.reason : '', className: isReview(frame) ? 'is-review' : '' }));
  const ticks = current.frames.map((frame, index) => `<span class="b-tick${isReview(frame) ? ' is-review' : ''}${frame.events.some(event => event.feedback || event.reminder) ? ' has-loop' : ''}" style="--at:${index / Math.max(1, current.frames.length - 1)}"></span>`).join('');
  const hatch = `<pattern id="${uid}-blank" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="b-blank-ground"/><line x1="0" y1="0" x2="0" y2="6" class="b-blank-line"/></pattern>`;

  host.innerHTML = `<main class="b-shell">
    <header class="b-header">
      <a class="b-brand" href="./index.html" aria-label="返回 Fold 原版">fold</a>
      <div class="b-title"><h1 id="b-page-title"></h1><p><span class="b-date"></span><span class="b-revision"></span></p></div>
      <div class="b-header-actions"><button class="b-feedback-button" data-b-action="feedback" hidden>批注 <span class="b-feedback-count"></span></button><button data-lab-inspect="inputs">输入 <span class="b-input-count"></span></button><button data-lab-inspect="state"><span class="b-wide-word">完整</span>状态 ↗</button><button class="b-about" data-b-action="story" aria-label="演示说明">?</button></div>
    </header>
    <div class="b-time-tools">
      <div class="b-play-controls"><button data-b-action="previous" aria-label="上一次整理" title="上一次整理，左方向键">←</button><button class="b-play" data-b-action="play" aria-label="播放回放"><span class="b-play-icon" aria-hidden="true">▷</span><span class="b-play-word">播放</span></button><button data-b-action="next" aria-label="下一次整理" title="下一次整理，右方向键">→</button></div>
      <div class="b-jump">${selectHTML('frame', '跳到一次整理', frameOptions, current.index)}</div>
      <button class="b-replay" data-b-action="replay" disabled title="重播上次过渡">↻ <span>重播过渡</span></button>
      <button class="b-mobile-read" data-b-action="read">摘要 ↗</button>
    </div>
    <div class="b-main">
      <section class="b-workspace" aria-label="事项份额随时间的变化">
        <div class="b-workspace-head"><nav class="b-breadcrumbs" aria-label="当前查看层级"></nav><div class="b-view-options"><div class="b-range" role="group" aria-label="显示的整理范围"><button data-b-range="recent" aria-pressed="true">近 5 次</button><button data-b-range="all" aria-pressed="false">全部</button></div><button class="b-compare" data-b-action="compare" aria-pressed="false">比较前后</button></div></div>
        <div class="b-chart-layout">
          <div class="b-history"><div class="b-plot-caption"><strong>此前</strong><span class="b-history-range"></span></div><div class="b-chart-scroll" tabindex="0" aria-label="历史份额变化，可横向滚动"><div class="b-plot"><svg class="b-flow-svg" aria-label="同一事项的份额随整理变化" role="group"><defs>${hatch}<clipPath id="${uid}-clip"><rect class="b-clip-rect"/></clipPath></defs><rect class="b-history-ground" fill="url(#${uid}-blank)"/><g class="b-guides"></g><g clip-path="url(#${uid}-clip)"><g class="b-paths"></g><g class="b-merge-paths"></g><g class="b-node-lines"></g><g class="b-loop-marks"></g></g></svg><div class="b-node-buttons"></div><div class="b-plot-empty" hidden><p>暂无事项记录。</p><button data-b-action="next">查看下一次整理 →</button></div></div></div></div>
          <div class="b-present"><div class="b-present-heading"><strong>此刻</strong><span class="b-budget"></span></div><div class="b-current-section"><svg class="b-section-svg" role="group" aria-label="当前注意力预算"><defs>${hatch.replace(`${uid}-blank`, `${uid}-blank-now`)}</defs><rect class="b-section-outline" fill="url(#${uid}-blank-now)"/><g class="b-current-fills"></g><g class="b-current-asks"></g><g class="b-label-links"></g></svg><div class="b-current-labels"></div><p class="b-current-empty" hidden>当前层暂无事项。</p></div></div>
        </div>
        <div class="b-chart-foot"><p class="b-legend"><span>带宽 = 份额</span><span><i class="b-key-blank" aria-hidden="true"></i>未分配</span><span><i class="b-key-ask" aria-hidden="true"></i>问你 <i class="b-key-answer" aria-hidden="true"></i>你的回应</span><span><i class="b-key-review" aria-hidden="true"></i>每日整理</span><span><i class="b-key-merge" aria-hidden="true"></i>明确合并</span></p><span class="b-check-note"></span></div>
        <div class="b-scrubber"><span class="b-first-date"></span><div class="b-slider" role="slider" tabindex="0" aria-label="沿整理次数回看时间" aria-valuemin="0" aria-valuemax="${current.frames.length - 1}"><div class="b-slider-track"><div class="b-slider-fill"></div>${ticks}</div><div class="b-slider-thumb" aria-hidden="true"></div></div><span class="b-last-date"></span></div>
      </section>
      <aside class="b-reader" aria-labelledby="b-reader-title"><div class="b-reader-head"><div><span class="b-reader-kicker">摘要与依据</span><h2 id="b-reader-title" tabindex="-1" aria-live="polite">本轮判断</h2></div><div class="b-reader-actions"><button class="b-reader-back" data-b-action="back-chart">← 图</button><button data-b-action="overview" hidden aria-label="回到本轮判断">↶ 概览</button><button data-lab-inspect="batch" title="查看本轮声明与回执">声明 ↗</button></div></div><div class="b-reader-scroll"><div class="b-reader-body"></div></div><div class="b-reader-foot"><span>人物与私人消息均为演示创作</span><button data-b-action="story">演示说明 ↗</button></div></aside>
    </div>
  </main>`;

  function svgElement(tag, className, parent) {
    const element = document.createElementNS(SVG, tag);
    if (className) element.setAttribute('class', className);
    parent.append(element); return element;
  }
  const set = (element, values) => { for (const [name, value] of Object.entries(values)) element.setAttribute(name, String(value)); };
  const buttonInfo = (element, item) => { element.dataset.bItem = item.id; element.setAttribute('aria-label', `查看${item.title}`); };
  const metaHTML = (item, ask) => `<b>${item.share}</b> 份 · ${ask ? `<em>${EXPECT[ask.expects[0]] || kindLabel[item.kind]}</em>` : kindLabel[item.kind]}`;
  const labelHTML = (item, ask) => `<button class="b-label-main" data-b-item="${esc(item.id)}" aria-controls="b-reader-title"><span>${esc(item.title)}</span><small>${metaHTML(item, ask)}</small></button>${item.children?.items.length ? `<button class="b-dive" data-b-dive="${esc(item.id)}" aria-label="进入${esc(item.title)}的子层，${item.children.items.length} 项" title="进入子层（独立 64 份）">${item.children.items.length}<span aria-hidden="true">›</span></button>` : ''}`;
  function measureLabels(items, width, dense) {
    const probe = document.createElement('div');
    probe.className = `b-current-label${dense ? ' is-dense' : ''}`; probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;transform:none;top:0;left:0;width:${width}px`;
    $('.b-current-labels').append(probe);
    const heights = new Map();
    for (const { item } of items) { probe.innerHTML = labelHTML(item, currentAsk(current, item.id)); heights.set(item.id, probe.getBoundingClientRect().height); }
    probe.remove(); return heights;
  }
  function removeMissing(map, wanted, remove) {
    for (const [key, element] of map) if (!wanted.has(key)) { remove(element); map.delete(key); }
  }
  function prepare(scene) {
    const width = scene.width, height = scene.height, sectionWidth = scene.barWidth + scene.leaderWidth;
    $('.b-plot').style.width = `${width}px`; $('.b-plot').style.height = `${height + AXIS_HEIGHT}px`;
    set($('.b-flow-svg'), { width, height, viewBox: `0 0 ${width} ${height}` });
    set($('.b-history-ground'), { x: 0, y: 0, width, height });
    set($('.b-clip-rect'), { x: 2, y: -8, width: Math.max(1, width - 4), height: height + 16 });
    $('.b-node-buttons').style.height = `${AXIS_HEIGHT}px`;
    $('.b-guides').innerHTML = [16, 32, 48].map(value => `<line x1="0" x2="${width}" y1="${value / 64 * height}" y2="${value / 64 * height}" class="b-guide"/>`).join('');
    set($('.b-section-svg'), { width: sectionWidth, height, viewBox: `0 0 ${sectionWidth} ${height}` });
    set($('.b-section-outline'), { x: 0, y: 0, width: scene.barWidth, height });
    $('.b-current-labels').style.left = `${sectionWidth}px`;
    $('.b-current-labels').classList.toggle('is-dense', Boolean(scene.dense));
    removeMissing(pathElements, scene.paths, element => element.remove());
    for (const [id, entry] of scene.paths) {
      let path = pathElements.get(id);
      if (!path) {
        path = svgElement('path', 'b-flow', $('.b-paths')); set(path, { tabindex: 0, role: 'button' });
        path.append(document.createElementNS(SVG, 'title')); pathElements.set(id, path);
      }
      buttonInfo(path, entry.item); path.setAttribute('fill', entry.color);
      path.firstElementChild.textContent = `${entry.item.title}；点击查看摘要与依据`;
    }
    removeMissing(currentElements, scene.current, entry => { entry.rect.remove(); entry.notch.remove(); entry.leader.remove(); entry.label.remove(); });
    for (const [id, entry] of scene.current) {
      let elements = currentElements.get(id);
      if (!elements) {
        const rect = svgElement('rect', 'b-current-fill', $('.b-current-fills'));
        set(rect, { x: 0, y: 0, height: 1, role: 'button', tabindex: 0 });
        const notch = svgElement('rect', 'b-ask-notch', $('.b-current-asks'));
        set(notch, { x: 0, y: 0, width: 5, height: 1 });
        const leader = svgElement('path', 'b-label-link', $('.b-label-links'));
        const label = document.createElement('div'); label.className = 'b-current-label'; label.dataset.bLabel = id;
        $('.b-current-labels').append(label); elements = { rect, notch, leader, label }; currentElements.set(id, elements);
      }
      const { rect, notch, leader, label } = elements;
      buttonInfo(rect, entry.item); leader.dataset.bItem = id; label.dataset.bFocusId = id; notch.dataset.bItem = id;
      set(rect, { width: scene.barWidth, fill: entry.color });
      notch.classList.toggle('is-on', Boolean(entry.ask) && entry.active !== false);
      if (entry.active !== false) {
        rect.dataset.bCurrentShare = id; rect.dataset.share = String(entry.item.share);
        rect.dataset.budget = String(scene.section.budget); delete rect.dataset.bMotionExit;
      } else { delete rect.dataset.bCurrentShare; rect.dataset.bMotionExit = id; }
      label.classList.toggle('has-ask', Boolean(entry.ask));
      const signature = `${entry.item.title}|${entry.item.share}|${entry.item.kind}|${entry.item.children?.items.length ?? 0}|${entry.ask?.expects?.[0] ?? ''}`;
      if (label.dataset.content !== signature) { label.dataset.content = signature; label.innerHTML = labelHTML(entry.item, entry.ask); }
    }
    removeMissing(nodeElements, scene.nodes, elements => { elements.line.remove(); elements.button.remove(); });
    for (const [index, node] of scene.nodes) {
      let elements = nodeElements.get(index);
      if (!elements) {
        const frame = current.frames[index];
        const line = svgElement('line', `b-node-line${isReview(frame) ? ' is-review' : ''}`, $('.b-node-lines'));
        const button = document.createElement('button'); button.className = `b-node-button${isReview(frame) ? ' is-review' : ''}`;
        button.dataset.bFrame = String(index);
        button.setAttribute('aria-label', `${frameName(frame, index)}${isReview(frame) ? `；${frame.signal.reason}，窗口内 0 条事件` : ''}`);
        button.innerHTML = `<span class="b-node-dot"></span><span>${formatTime(frame.at)}</span><small>${isReview(frame) ? '每日整理' : formatDate(frame.at)}</small>`;
        $('.b-node-buttons').append(button); elements = { line, button }; nodeElements.set(index, elements);
      }
      elements.line.classList.toggle('is-current', index === current.index);
      elements.line.classList.toggle('is-baseline', current.comparing && index === current.baseIndex);
      elements.button.classList.toggle('is-current', index === current.index);
      elements.button.tabIndex = node.active === false ? -1 : 0;
      if (index === current.index) elements.button.setAttribute('aria-current', 'step'); else elements.button.removeAttribute('aria-current');
    }
    removeMissing(mergeElements, scene.merges, element => element.remove());
    for (const [key, link] of scene.merges) {
      let path = mergeElements.get(key);
      if (!path) { path = svgElement('path', 'b-merge-link', $('.b-merge-paths')); path.append(document.createElementNS(SVG, 'title')); mergeElements.set(key, path); }
      path.dataset.bItem = link.to; path.dataset.bSourceId = link.from;
      path.firstElementChild.textContent = `${link.source.title}，明确合并至${link.target.title}`;
    }
    removeMissing(markElements, scene.marks, elements => elements.group.remove());
    for (const [key, mark] of scene.marks) {
      let elements = markElements.get(key);
      if (!elements) {
        const group = svgElement('g', `b-loop is-${mark.kind}`, $('.b-loop-marks'));
        const title = svgElement('title', '', group);
        const line = mark.askIndex != null ? svgElement('path', 'b-loop-line', group) : null;
        const ring = mark.askIndex != null ? svgElement('circle', 'b-loop-ask', group) : null;
        const dot = svgElement('circle', 'b-loop-dot', group);
        const hand = mark.kind !== 'answer' ? svgElement('path', 'b-loop-hand', group) : null;
        elements = { group, title, line, ring, dot, hand }; markElements.set(key, elements);
      }
      elements.group.dataset.bItem = mark.anchor;
      elements.title.textContent = markTitle(mark, current.frames, current.state);
    }
    $('.b-plot-empty').hidden = scene.paths.size > 0;
    $('.b-current-empty').hidden = scene.section.items.length > 0;
    updateEmphasis();
  }
  function draw(scene) {
    // The viewing window moves with the bands. Applying the final scroll before
    // the shape tween would make every old node jump left by one column.
    $('.b-plot').style.width = `${scene.width}px`;
    set($('.b-flow-svg'), { width: scene.width, height: scene.height, viewBox: `0 0 ${scene.width} ${scene.height}` });
    set($('.b-history-ground'), { width: scene.width, height: scene.height });
    set($('.b-clip-rect'), { width: Math.max(1, scene.width - 4), height: scene.height + 16 });
    for (const [id, entry] of scene.paths) {
      const path = pathElements.get(id); path.setAttribute('d', bandPath(entry.points));
      path.style.setProperty('--b-motion-opacity', entry.opacity ?? 1);
    }
    for (const [id, entry] of scene.current) {
      const { rect, notch, label, leader } = currentElements.get(id);
      const transform = `translate(0 ${entry.y}) scale(1 ${Math.max(0, entry.height)})`;
      rect.setAttribute('transform', transform); notch.setAttribute('transform', transform);
      rect.dataset.y = String(entry.y); rect.dataset.height = String(entry.height);
      const opacity = entry.height > .01 ? entry.opacity ?? 1 : 0;
      rect.style.setProperty('--b-motion-opacity', opacity); notch.style.setProperty('--b-motion-opacity', opacity);
      label.style.transform = `translateY(${entry.labelY}px) translateY(-50%)`;
      label.style.setProperty('--b-motion-opacity', entry.opacity ?? 1);
      label.style.pointerEvents = entry.opacity < .08 ? 'none' : '';
      const middle = scene.barWidth + scene.leaderWidth * .5;
      leader.setAttribute('d', `M ${scene.barWidth} ${center(entry)} C ${middle} ${center(entry)} ${middle} ${entry.labelY} ${scene.barWidth + scene.leaderWidth - 2} ${entry.labelY}`);
      leader.style.setProperty('--b-motion-opacity', entry.opacity ?? 1);
    }
    for (const [index, entry] of scene.nodes) {
      const { line, button } = nodeElements.get(index); set(line, { x1: entry.x, x2: entry.x, y1: 0, y2: scene.height });
      const halfLabel = mobile.matches ? 15.5 : 29;
      const labelX = Math.max(halfLabel, Math.min(scene.width - halfLabel, entry.x));
      button.style.transform = `translateX(${labelX}px) translateX(-50%)`;
      button.style.opacity = entry.opacity ?? 1; line.style.opacity = entry.opacity ?? 1;
    }
    for (const [key, entry] of scene.merges) {
      const middle = (entry.x1 + entry.x2) / 2, path = mergeElements.get(key);
      path.setAttribute('d', `M ${entry.x1} ${entry.y1} C ${middle} ${entry.y1} ${middle} ${entry.y2} ${entry.x2} ${entry.y2}`);
      path.style.setProperty('--b-motion-opacity', entry.opacity ?? 1);
    }
    // Feedback marks ride on the drawn band, so they follow every tween frame.
    for (const [key, mark] of scene.marks) {
      const elements = markElements.get(key), points = scene.paths.get(mark.anchor)?.points ?? [];
      const at = points.find(point => point.index === mark.index);
      if (!at || !(at.height > 0 || points.some(point => point.height > 0))) { elements.group.style.display = 'none'; continue; }
      elements.group.style.display = '';
      const opacity = scene.paths.get(mark.anchor)?.opacity ?? 1;
      elements.group.style.setProperty('--b-motion-opacity', opacity);
      const x = at.x, y = center(at);
      set(elements.dot, { cx: x, cy: y, r: mobile.matches ? 3.6 : 4.4 });
      if (elements.hand) elements.hand.setAttribute('d', `M ${x} ${y - 2.6} L ${x} ${y} L ${x + 2} ${y + 1.2}`);
      if (elements.line) {
        const trail = points.filter(point => point.index >= mark.askIndex && point.index <= mark.index);
        const first = trail[0];
        elements.line.setAttribute('d', trail.length > 1 ? centerPath(trail) : '');
        if (first && first.index === mark.askIndex) { set(elements.ring, { cx: first.x, cy: center(first), r: mobile.matches ? 3.2 : 4 }); elements.ring.style.display = ''; }
        else elements.ring.style.display = 'none';
      }
    }
    $('.b-chart-scroll').scrollLeft = scene.scrollLeft ?? 0;
  }
  const motion = createTimeMotion({ prepare, draw, reduced: () => reduced.matches,
    complete() { updateEmphasis(); },
    status(status, progress) { host.dataset.bMotion = status; host.dataset.bMotionProgress = progress.toFixed(4); $('.b-replay').disabled = !motion.canReplay; },
  });

  function makeScene(s) {
    const { layers, order, merges, marks } = cache(s.layerId);
    const availableHeight = Math.min($('.b-current-section').clientHeight, $('.b-chart-scroll').clientHeight - AXIS_HEIGHT);
    const height = Math.max(130, Math.floor(availableHeight));
    const holderWidth = Math.max(120, $('.b-chart-scroll').clientWidth);
    const first = range === 'all' ? 0 : Math.max(0, s.index - 4), last = s.index;
    const indexes = Array.from({ length: last - first + 1 }, (_, index) => first + index);
    const width = range === 'all' ? Math.max(holderWidth, indexes.length * (mobile.matches ? 34 : 64)) : holderWidth;
    const step = (width - 28) / Math.max(1, indexes.length - 1);
    const xFor = index => indexes.length === 1 ? width / 2 : 14 + (index - first) * step;
    const sections = layers.map(layer => layoutSection(layer, order, height));
    const section = layoutSection(s.layer, order, height);
    const sectionWidth = $('.b-current-section').getBoundingClientRect().width;
    const barWidth = mobile.matches ? 34 : Math.round(Math.min(96, Math.max(64, sectionWidth * .2))), leaderWidth = mobile.matches ? 14 : 26;
    const labelWidth = sectionWidth - barWidth - leaderWidth;
    let heights = measureLabels(section.items, labelWidth, false), dense = false;
    const total = [...heights.values()].reduce((sum, value) => sum + value, 0);
    if (total + section.items.length * 3 > height) { heights = measureLabels(section.items, labelWidth, true); dense = true; }
    const labels = labelPositions(section.items, height, { heights, gap: dense ? 1 : 6 });
    const ids = order.filter(id => indexes.some(index => sections[index].points.get(id)?.height > 0));
    const paths = new Map(ids.map(id => {
      const item = getItem(s.state, id) || [...indexes].reverse().map(index => getItem(s.records[index].state, id)).find(Boolean);
      return [id, { id, item, color: colorFor(item, s.state), opacity: 1,
        points: indexes.map(index => ({ index, x: xFor(index), ...sections[index].points.get(id) })) }];
    }));
    const currentItems = new Map(section.items.map(point => [point.id, { ...point, labelY: labels.get(point.id), color: colorFor(point.item, s.state),
      ask: currentAsk(s, point.id), opacity: 1, active: true }]));
    const mergeMap = new Map(merges.filter(link => link.index > first && link.index <= last).map(link => {
      const source = sections[link.index - 1].points.get(link.from), target = sections[link.index].points.get(link.to);
      return [`${link.index}:${link.from}:${link.to}`, { ...link, x1: xFor(link.index - 1), y1: center(source), x2: xFor(link.index), y2: center(target), opacity: 1 }];
    }));
    const markMap = new Map(marks.filter(mark => mark.index >= first && mark.index <= last && paths.has(mark.anchor)).map(mark => [mark.key, mark]));
    return { index: s.index, layerId: s.layerId, first, last, width, height, section, sections, order, paths, current: currentItems, xFor,
      nodes: new Map(indexes.map(index => [index, { index, x: xFor(index), opacity: 1, active: true }])), merges: mergeMap, marks: markMap,
      scrollLeft: $('.b-chart-scroll').scrollLeft, barWidth, leaderWidth, dense };
  }

  function renderBreadcrumbs(s) {
    $('.b-breadcrumbs').innerHTML = `${s.layerId ? '<button class="b-rise" data-b-action="rise" aria-label="返回上层">↑</button>' : ''}<button data-b-action="root" ${s.layerId ? '' : 'aria-current="page"'}>全部事项</button>${s.path.map((item, index) => `<span aria-hidden="true">/</span><button data-b-dive="${esc(item.id)}" title="${esc(item.title)}" ${index === s.path.length - 1 ? 'aria-current="page"' : ''}>${esc(item.title)}</button>`).join('')}${s.layerId ? '<span class="b-layer-note">子层独立 64 份</span>' : ''}`;
  }
  function signalHTML(s) {
    const signal = s.frame.signal, receipt = s.records[s.index].receipt;
    if (!signal) return '<p class="b-signal">初始状态，尚未收到输入。</p>';
    const window = `${stamp(signal.window.from)}—${formatTime(signal.window.to)}`;
    if (signal.type === 'review') {
      return `<div class="b-signal is-review"><strong>${esc(signal.reason)}</strong><span>窗口 ${window} 收到 0 条事件</span><span>覆盖：${esc(signal.coverage)}</span><span>结果：${receipt?.type === 'checked' ? '检查后不改' : '按时间重看后有调整'}</span><small>没有消息不等于现实没有变化。</small></div>`;
    }
    return `<p class="b-signal">${signal.reason ? `${esc(signal.reason)} · ` : ''}窗口 ${window} 收到 ${signal.received} 条输入${receipt?.type === 'checked' ? ' · 检查后不改' : ''}</p>`;
  }
  const changeText = (mark, s) => mark.changes.length ? mark.changes.map(change => {
    const before = mark.index > 0 ? getItem(s.records[mark.index - 1].state, change.item) : null, after = getItem(s.records[mark.index].state, change.item);
    const shares = before?.status === 'active' && after?.status === 'active' && before.share !== after.share ? ` ${before.share} → ${after.share} 份` : '';
    return `${CHANGE_NAMES[change.type] || change.type}${shares}`;
  }).filter((text, index, all) => all.indexOf(text) === index).join('，') : '状态未变';
  function loopStepHTML(mark, s, { withTarget = true } = {}) {
    const target = getItem(s.state, mark.target) || getItem(s.records[mark.index].state, mark.target);
    const title = withTarget && target ? `<button data-b-item="${esc(mark.anchor)}">${esc(target.title)} ↗</button>` : '';
    if (mark.kind === 'reminder') {
      return `<article class="b-loop-step is-reminder"><small><i class="b-glyph-clock" aria-hidden="true"></i>到点提醒 · ${stamp(mark.event.at)}</small><p>你 ${stamp(mark.event.reminder.requested_at)} 要求此时再看。按现在的事实重判，不沿用当时的结论。</p><p class="b-loop-after">本轮：${changeText(mark, s)} ${title}</p></article>`;
    }
    if (mark.kind === 'snooze') {
      return `<article class="b-loop-step is-snooze"><small><i class="b-glyph-clock" aria-hidden="true"></i>稍后提醒 · ${stamp(mark.event.at)} · ${VIA[mark.link.via] || ''}</small><p>约定 ${stamp(mark.link.until)} 再提醒。不是已阅，也不改截止。</p>${title ? `<p class="b-loop-after">${title}</p>` : ''}</article>`;
    }
    return `<article class="b-loop-step">${mark.ask ? `<p class="b-loop-ask"><small><i class="b-glyph-ask" aria-hidden="true"></i>问 · ${stamp(s.frames[mark.ask.frameIndex].at)}</small>${esc(mark.ask.prompt)}</p>` : ''}<small><i class="b-glyph-answer" aria-hidden="true"></i>你的回应 · ${stamp(mark.event.at)} · ${VIA[mark.link.via] || ''} · ${MEANING[mark.link.meaning] || ''}</small><p class="b-loop-quote">${esc(mark.event.text)}</p><p class="b-loop-after">本轮：${changeText(mark, s)} ${title}</p></article>`;
  }
  function askHTML(ask) {
    return `<div class="b-ask"><small>${EXPECT[ask.expects[0]] || '登记了回应路径'} · 登记于 ${stamp(current.frames[ask.frameIndex].at)}</small><p>${esc(ask.prompt)}</p><p class="b-ask-actions">可回应：${ask.actions.map(action => `<span>${esc(action.label)}</span>`).join('')}</p></div>`;
  }
  function itemLoopHTML(s, id) {
    const ask = currentAsk(s, id);
    const trail = feedbackTrail(s, id);
    const marks = cache(s.layerId).marks.filter(mark => mark.index <= s.index && mark.target === id);
    const known = new Set(marks.map(mark => mark.event.id));
    const extra = trail.filter(entry => !known.has(entry.event.id));
    if (!ask && !marks.length && !extra.length) return '';
    return `<section class="b-item-loop"><h3>回应路径</h3>${ask ? askHTML(ask) : '<p class="b-muted-line">此刻这一版没有登记回应路径。</p>'}${marks.length || extra.length ? `<div class="b-loop-list">${marks.map(mark => loopStepHTML(mark, s, { withTarget: false })).join('')}${extra.map(entry => `<article class="b-loop-step"><small>${stamp(entry.event.at)}</small><p class="b-loop-quote">${esc(entry.event.text)}</p></article>`).join('')}</div>` : ''}</section>`;
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
    }).join('')}</div>` : '<p class="b-no-change">当前层没有内容变化，事项份额保持不变。</p>'}</div>`;
  }
  function renderReader(s, force = false) {
    const key = `${s.index}|${s.layerId}|${s.selectedId}|${readerMode}|${s.baseIndex}|${s.state.event_seq}`;
    if (!force && key === readerStamp) return;
    readerStamp = key; closeSelect(false);
    const selected = s.selectedItem;
    $('.b-reader-actions [data-b-action="overview"]').hidden = !selected && readerMode === 'overview';
    let title = '本轮判断', content = '';
    if (readerMode === 'feedback') {
      title = '待确认批注';
      const annotations = s.state.pending_annotations ?? [];
      content = annotations.length ? `<div class="b-feedback-list">${annotations.map(annotation => {
        const id = annotation.item ?? annotation.item_id, item = getItem(s.state, id);
        return `<article><p>${esc(annotation.text)}</p><footer>${esc(annotation.author || '用户')} · 已保存，等待 Agent 处理确认</footer><button data-b-item="${esc(id)}">${esc(item?.title || id)}${item?.status !== 'active' ? '（历史事项）' : ''} ↗</button></article>`;
      }).join('')}</div>` : '<p>暂无待确认批注。</p>';
    } else if (readerMode === 'story') {
      title = '演示说明';
      content = `<div class="b-story"><p>${esc(s.scenario.persona.context)}</p><h3>公开资料</h3>${s.scenario.publicSources.map(source => `<article><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a><p>${esc(source.usedFor)}</p></article>`).join('')}</div>`;
    } else if (readerMode === 'diff') { title = '前后变化'; content = diffHTML(s); }
    else if (selected) {
      title = '事项详情';
      content = (selected.status === 'active' ? '' : `<p class="b-history-notice">${selected.status === 'merged' ? '该事项已合并' : '该事项已撤下'}，以下是保留的历史，不占用此刻的预算。</p>`) + itemLoopHTML(s, selected.id) + detailHTML(s, selected.id);
    } else {
      content = `<p class="b-narrative">${esc(s.frame.narrative)}</p>${signalHTML(s)}`;
      const loops = cache(s.layerId).marks.filter(mark => mark.index === s.index);
      if (loops.length) content += `<section class="b-round-loop"><h3>本轮收到的回应</h3>${loops.map(mark => loopStepHTML(mark, s)).join('')}</section>`;
      const mergeGroups = new Map();
      for (const link of cache(s.layerId).merges.filter(link => link.index === s.index)) {
        if (!mergeGroups.has(link.to)) mergeGroups.set(link.to, { ...link, sources: [] });
        mergeGroups.get(link.to).sources.push(link.source.title);
      }
      content += [...mergeGroups.values()].map(link => `<button class="b-merge-note" data-b-item="${esc(link.to)}"><small>本轮明确合并了 ${link.sources.length} 个事项</small><span>${esc(link.target.title)} ↗</span><p>${esc(link.target.reason)}</p></button>`).join('');
      content += s.layer.items.length ? `<div class="b-reading-list">${s.layer.items.map(item => {
        const ask = currentAsk(s, item.id);
        return `<article class="b-reading-row${ask ? ' has-ask' : ''}" data-b-focus-id="${esc(item.id)}"><div class="b-reading-title"><button data-b-item="${esc(item.id)}" style="--item-color:${colorFor(item, s.state)}"><span class="b-item-dot" aria-hidden="true"></span>${esc(item.title)}</button><span>${metaHTML(item, ask)}</span></div>${ask ? `<p class="b-reading-ask">问：${esc(ask.prompt)}</p>` : ''}<p>${esc(item.summary)}</p>${item.children?.items.length ? `<div class="b-row-links"><button data-b-dive="${esc(item.id)}">${item.children.items.length} 个子项 ↗</button></div>` : ''}</article>`;
      }).join('')}</div>` : '<div class="b-empty-reader"><p>暂无事项。</p><button data-b-action="next">查看下一次整理 →</button></div>';
    }
    $('#b-reader-title').textContent = title; $('.b-reader-body').innerHTML = content; $('.b-reader-scroll').scrollTop = 0;
  }

  function anchorFor(id, visibleIds) {
    let item = id && (getItem(current.state, id) || getItem(current.baseState, id));
    const visited = new Set();
    while (item && !visibleIds.has(item.id) && item.parent_id && !visited.has(item.id)) {
      visited.add(item.id); item = getItem(current.state, item.parent_id) || getItem(current.baseState, item.parent_id);
    }
    return item && visibleIds.has(item.id) ? item.id : visibleIds.has(id) ? id : null;
  }
  function updateEmphasis() {
    const elements = [...host.querySelectorAll('.b-chart-layout [data-b-item], .b-current-label[data-b-focus-id]')];
    const visibleIds = new Set(elements.map(element => element.dataset.bItem ?? element.dataset.bFocusId));
    const anchor = anchorFor(hoveredId || focusedId || current.selectedId, visibleIds);
    const ids = new Set(anchor ? [anchor] : []);
    if (anchor) {
      const links = cache(current.layerId).merges.filter(link => link.index <= current.index);
      for (let pass = 0; pass < links.length; pass += 1) for (const link of links) if (ids.has(link.to) || ids.has(link.from)) { ids.add(link.to); ids.add(link.from); }
    }
    $('.b-chart-layout').classList.toggle('has-emphasis', ids.size > 0);
    for (const element of elements) {
      const id = element.dataset.bItem ?? element.dataset.bFocusId;
      element.classList.toggle('is-emphasized', ids.has(id));
      if (element.matches('button, [role="button"]')) element.setAttribute('aria-pressed', String(id === current.selectedId));
    }
    host.dataset.bEmphasis = [...ids].join(',');
  }

  // Slider: role="slider" on a div, pointer drag plus arrow/page/home/end keys.
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

  // Listbox behaviour, shared by the frame jumper and the comparison baseline.
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

  function render(s, event) {
    current = s;
    if (event.type === 'select' && s.selectedId) readerMode = 'item';
    if (event.type === 'compare') readerMode = s.comparing ? 'diff' : 'overview';
    if (event.type === 'dive' || event.type === 'rise') { readerMode = 'overview'; host.classList.remove('is-reading'); }
    $('.b-date').textContent = `${formatDate(s.now)} · ${formatTime(s.now)}`;
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
    renderBreadcrumbs(s); renderReader(s);
    const dimensions = `${Math.round($('.b-chart-scroll').clientWidth)}:${Math.round($('.b-current-section').clientHeight)}`;
    const chartKey = `${s.index}|${s.layerId}|${s.comparing}|${s.baseIndex}|${range}|${dimensions}`;
    if (chartKey !== chartStamp || event.type === 'resize') {
      hoveredId = null; focusedId = null;
      const scene = makeScene(s);
      $('.b-history-range').textContent = scene.first === scene.last ? `第 ${scene.last + 1} 次整理` : `第 ${scene.first + 1}—${scene.last + 1} 次整理`;
      $('.b-budget').innerHTML = `<strong>${scene.section.used}</strong> / ${scene.section.budget} 份${scene.section.blank ? `<span class="b-blank-count"><i class="b-key-blank" aria-hidden="true"></i>${scene.section.blank} 份未分配</span>` : ''}`;
      const checked = s.index > 0 && s.frameDiff.changes.length === 0;
      $('.b-check-note').textContent = checked ? (isReview(s.frame) ? '每日整理：检查后不改' : '检查过，状态未变') : '';
      host.dataset.bContentChanged = String(!checked);
      const moving = ['frame', 'dive', 'rise', 'range'].includes(event.type);
      const scrollLeft = $('.b-chart-scroll').scrollLeft;
      scene.scrollLeft = Math.max(0, scene.width - $('.b-chart-scroll').clientWidth);
      motion.transition(scene, { kind: event.type, anchorId: event.anchorId, instant: !moving || dragging, duration: 1600, scrollLeft });
      chartStamp = chartKey;
    } else updateEmphasis();
    host.dataset.bStateIndex = String(s.index); host.dataset.bLayer = s.layerId ?? 'root';
  }
  function showReader() { if (mobile.matches) { host.classList.add('is-reading'); $('#b-reader-title').focus({ preventScroll: true }); } }
  function click(event) {
    const option = event.target.closest('.b-select [role="option"]');
    if (option) { chooseOption(option.closest('.b-select'), option); return; }
    const selectButton = event.target.closest('.b-select-button');
    if (selectButton) { const root = selectButton.closest('.b-select'); if (openSelect === root) closeSelect(true); else openSelectBox(root); return; }
    const button = event.target.closest('button, [role="button"], .b-loop');
    if (!button || !host.contains(button)) return;
    if (button.dataset.bItem) { model.select(button.dataset.bItem); showReader(); return; }
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
      case 'overview': readerMode = 'overview'; model.select(null); break;
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
    if (event.target.matches('.b-flow, .b-current-fill') && ['Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); model.select(event.target.dataset.bItem); showReader();
    }
  }
  const itemFrom = element => element?.closest?.('[data-b-item], [data-b-focus-id]')?.dataset.bItem ?? element?.closest?.('[data-b-focus-id]')?.dataset.bFocusId ?? null;
  function pointerover(event) { const id = itemFrom(event.target); if (id !== hoveredId) { hoveredId = id; updateEmphasis(); } }
  function pointerout(event) { const id = itemFrom(event.relatedTarget); if (id !== hoveredId) { hoveredId = id; updateEmphasis(); } }
  function focusin(event) { focusedId = itemFrom(event.target); updateEmphasis(); }
  function focusout() { queueMicrotask(() => { if (!disposed) { focusedId = itemFrom(document.activeElement); updateEmphasis(); } }); }
  function outside(event) { if (openSelect && !openSelect.contains(event.target)) closeSelect(false); }
  function scrolled(event) { if (openSelect && !openSelect.querySelector('.b-select-list').contains(event.target)) closeSelect(false); }
  const listeners = { click, keydown, pointerover, pointerout, focusin, focusout,
    pointerdown: sliderPointer, pointermove: sliderPointer, pointerup: sliderPointer, pointercancel: sliderPointer };
  for (const [name, listener] of Object.entries(listeners)) host.addEventListener(name, listener);
  document.addEventListener('pointerdown', outside, true);
  host.addEventListener('scroll', scrolled, true);
  const onResize = () => closeSelect(false); addEventListener('resize', onResize);
  const reduceMotion = () => { if (reduced.matches) motion.settle(); $('.b-replay').disabled = !motion.canReplay; };
  reduced.addEventListener?.('change', reduceMotion);
  const unsubscribe = model.subscribe(render);
  let lastSize = `${$('.b-chart-scroll').clientWidth}:${$('.b-current-section').clientHeight}`;
  const observer = new ResizeObserver(() => {
    const size = `${$('.b-chart-scroll').clientWidth}:${$('.b-current-section').clientHeight}`;
    if (disposed || size === lastSize || mobile.matches && host.classList.contains('is-reading')) return;
    lastSize = size; cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { if (!disposed) render(current, { type: 'resize' }); });
  });
  observer.observe($('.b-chart-layout')); host.dataset.bBuild = 'b-polish-1';
  return () => {
    disposed = true; unsubscribe(); observer.disconnect(); cancelAnimationFrame(resizeFrame); motion.stop();
    for (const [name, listener] of Object.entries(listeners)) host.removeEventListener(name, listener);
    document.removeEventListener('pointerdown', outside, true); host.removeEventListener('scroll', scrolled, true);
    removeEventListener('resize', onResize);
    reduced.removeEventListener?.('change', reduceMotion);
  };
}

export default mount;
