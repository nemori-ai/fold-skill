import {
  escapeHTML as esc, formatDate, formatTime, kindLabel,
  getItem, getLayer, colorFor, detailHTML,
} from './shared.mjs?v=feedback-loop-1';
import { stableOrder, layoutSection, bandPath, labelPositions } from './b-layout.mjs?v=bc-refinement-2';
import { createTimeMotion } from './b-motion.mjs?v=bc-refinement-2';

const CHANGE_NAMES = { added: '新增事项', updated: '内容更新', withdrawn: '已撤下',
  restored: '恢复事项', merged: '已合并', annotations_changed: '反馈变化' };
const SVG = 'http://www.w3.org/2000/svg';
const AXIS_HEIGHT = 42;
const frameName = (frame, index) => `${String(index + 1).padStart(2, '0')} · ${formatDate(frame.at)} ${formatTime(frame.at)} · ${frame.title}`;
const center = point => point.y + point.height / 2;
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

export function mount(host, model) {
  host.classList.add('variant-b');
  const clipId = `b-history-clip-${++mountNumber}`;
  const $ = selector => host.querySelector(selector);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 760px)');
  let current = model.snapshot(), range = 'recent', readerMode = 'overview';
  let hoveredId = null, focusedId = null, disposed = false, resizeFrame = null;
  let chartStamp = '', readerStamp = '';
  const layerCache = new Map(), pathElements = new Map(), currentElements = new Map();
  const nodeElements = new Map(), mergeElements = new Map();
  const cache = layerId => {
    const key = layerId ?? '__root__';
    if (!layerCache.has(key)) {
      const layers = current.records.map(record => getLayer(record.state, layerId));
      layerCache.set(key, { layers, order: stableOrder(layers), merges: explicitMerges(current.records, layerId) });
    }
    return layerCache.get(key);
  };

  host.innerHTML = `<main class="b-shell">
    <header class="b-header">
      <a class="b-brand" href="./index.html" aria-label="返回 Fold 原版">fold</a>
      <div class="b-title"><h1 id="b-page-title"></h1><p><span class="b-date"></span><span class="b-revision"></span></p></div>
      <div class="b-header-actions"><button class="b-feedback-button" data-b-action="feedback" hidden><span class="b-wide-word">待确认</span>反馈 <span class="b-feedback-count"></span></button><button data-lab-inspect="inputs">输入 <span class="b-input-count"></span></button><button data-lab-inspect="state"><span class="b-wide-word">完整</span>状态 ↗</button><button class="b-about" data-b-action="story" aria-label="演示说明">?</button></div>
    </header>
    <div class="b-time-tools">
      <div class="b-play-controls"><button data-b-action="previous" aria-label="上一次整理" title="上一次整理，左方向键">←</button><button class="b-play" data-b-action="play" aria-label="播放回放"><span class="b-play-icon" aria-hidden="true">▷</span><span class="b-play-word">播放</span></button><button data-b-action="next" aria-label="下一次整理" title="下一次整理，右方向键">→</button></div>
      <label class="b-jump"><span class="b-visually-hidden">跳到一次整理</span><select aria-label="跳到一次整理">${current.frames.map((frame, index) => `<option value="${index}">${esc(frameName(frame, index))}</option>`).join('')}</select></label>
      <button class="b-replay" data-b-action="replay" disabled title="重播上次过渡">↻ <span>重播过渡</span></button>
      <button class="b-mobile-read" data-b-action="read">查看摘要 ↗</button>
    </div>
    <div class="b-main">
      <section class="b-workspace" aria-label="事项份额随时间的变化">
        <div class="b-workspace-head"><nav class="b-breadcrumbs" aria-label="当前查看层级"></nav><div class="b-view-options"><div class="b-range" aria-label="显示的整理范围"><button data-b-range="recent" aria-pressed="true">近 5 次</button><button data-b-range="all" aria-pressed="false">全部记录</button></div><button class="b-compare" data-b-action="compare" aria-pressed="false">比较前后</button></div></div>
        <div class="b-chart-layout">
          <div class="b-history"><div class="b-plot-caption"><strong>此前</strong><span class="b-history-range"></span></div><div class="b-chart-scroll" tabindex="0" aria-label="历史份额变化，可横向滚动"><div class="b-plot"><svg class="b-flow-svg" preserveAspectRatio="none" aria-label="同一事项的份额随整理变化" role="group"><defs><clipPath id="${clipId}"><rect class="b-clip-rect"/></clipPath></defs><g class="b-guides"></g><g clip-path="url(#${clipId})"><g class="b-paths"></g><g class="b-merge-paths"></g><g class="b-node-lines"></g></g></svg><div class="b-node-buttons"></div><div class="b-plot-empty" hidden><p>暂无事项记录。</p><button data-b-action="next">查看下一次整理 →</button></div></div></div></div>
          <div class="b-present"><div class="b-present-heading"><strong>此刻</strong><span class="b-budget"></span></div><div class="b-current-section"><svg class="b-section-svg" role="group" aria-label="当前注意力预算"><rect class="b-section-outline"/><g class="b-current-fills"></g><g class="b-label-links"></g></svg><div class="b-current-labels"></div><p class="b-current-empty" hidden>当前层暂无事项。</p></div><div class="b-current-footer"><span class="b-blank-note"></span></div></div>
        </div>
        <div class="b-chart-foot"><p>粗细表达份额，悬停追踪同一事项。节点按整理次数等距排列。</p><span class="b-check-note"></span></div>
        <div class="b-scrubber"><span class="b-first-date"></span><input type="range" min="0" max="${current.frames.length - 1}" step="1" value="${current.index}" aria-label="沿整理次数回看时间"><span class="b-last-date"></span></div>
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
  const labelHTML = item => `<button data-b-item="${esc(item.id)}" aria-controls="b-reader-title"><span>${esc(item.title)}</span><small>${item.share} 份 · ${kindLabel[item.kind]}</small></button>${item.children?.items.length ? `<button class="b-dive" data-b-dive="${esc(item.id)}" aria-label="进入${esc(item.title)}的子层" title="进入子层">↗</button>` : ''}`;
  function measureLabels(items, width) {
    const probe = document.createElement('div');
    probe.className = 'b-current-label'; probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;transform:none;top:0;left:0;width:${width}px`;
    $('.b-current-labels').append(probe);
    const heights = new Map();
    for (const { item } of items) {
      probe.innerHTML = labelHTML(item); heights.set(item.id, probe.getBoundingClientRect().height);
    }
    probe.remove(); return heights;
  }
  function removeMissing(map, wanted, remove) {
    for (const [key, element] of map) if (!wanted.has(key)) { remove(element); map.delete(key); }
  }
  function prepare(scene) {
    const width = scene.width, height = scene.height;
    $('.b-plot').style.width = `${width}px`; $('.b-plot').style.height = `${height + AXIS_HEIGHT}px`;
    set($('.b-flow-svg'), { width, height, viewBox: `0 0 ${width} ${height}` });
    set($('.b-clip-rect'), { x: 18, y: 0, width: Math.max(1, width - 36), height });
    $('.b-node-buttons').style.height = `${AXIS_HEIGHT}px`;
    $('.b-guides').innerHTML = [0, 16, 32, 48, 64].map(value => `<line x1="0" x2="${width}" y1="${value / 64 * height}" y2="${value / 64 * height}" class="b-guide"/>`).join('');
    set($('.b-section-svg'), { width: scene.barWidth + scene.leaderWidth, height, viewBox: `0 0 ${scene.barWidth + scene.leaderWidth} ${height}` });
    set($('.b-section-outline'), { x: 0, y: 0, width: scene.barWidth, height });
    $('.b-current-labels').style.left = `${scene.barWidth + scene.leaderWidth}px`;
    $('.b-chart-layout').classList.toggle('is-compact', height < 350);
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
    removeMissing(currentElements, scene.current, entry => { entry.rect.remove(); entry.leader.remove(); entry.label.remove(); });
    for (const [id, entry] of scene.current) {
      let elements = currentElements.get(id);
      if (!elements) {
        const rect = svgElement('rect', 'b-current-fill', $('.b-current-fills'));
        set(rect, { x: 0, y: 0, height: 1, role: 'button', tabindex: 0 });
        const leader = svgElement('path', 'b-label-link', $('.b-label-links'));
        const label = document.createElement('div'); label.className = 'b-current-label'; label.dataset.bLabel = id;
        $('.b-current-labels').append(label); elements = { rect, leader, label }; currentElements.set(id, elements);
      }
      const { rect, leader, label } = elements;
      buttonInfo(rect, entry.item); leader.dataset.bItem = id; label.dataset.bFocusId = id;
      set(rect, { width: scene.barWidth, fill: entry.color });
      if (entry.active !== false) {
        rect.dataset.bCurrentShare = id; rect.dataset.share = String(entry.item.share);
        rect.dataset.budget = String(scene.section.budget); delete rect.dataset.bMotionExit;
      } else { delete rect.dataset.bCurrentShare; rect.dataset.bMotionExit = id; }
      const signature = `${entry.item.title}|${entry.item.share}|${entry.item.kind}|${entry.item.children?.items.length ?? 0}`;
      if (label.dataset.content !== signature) {
        label.dataset.content = signature;
        label.innerHTML = labelHTML(entry.item);
      }
    }
    removeMissing(nodeElements, scene.nodes, elements => { elements.line.remove(); elements.button.remove(); });
    for (const [index, node] of scene.nodes) {
      let elements = nodeElements.get(index);
      if (!elements) {
        const line = svgElement('line', 'b-node-line', $('.b-node-lines'));
        const button = document.createElement('button'); button.className = 'b-node-button';
        button.dataset.bFrame = String(index); button.setAttribute('aria-label', frameName(current.frames[index], index));
        button.innerHTML = `<span class="b-node-dot"></span><span>${formatTime(current.frames[index].at)}</span><small>${formatDate(current.frames[index].at)}</small>`;
        $('.b-node-buttons').append(button); elements = { line, button }; nodeElements.set(index, elements);
      }
      elements.line.classList.toggle('is-current', index === current.index);
      elements.line.classList.toggle('is-baseline', current.comparing && index === current.baseIndex);
      elements.button.classList.toggle('is-current', index === current.index);
      elements.button.classList.toggle('is-endpoint', index === scene.first || index === scene.last);
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
    $('.b-plot-empty').hidden = scene.paths.size > 0;
    $('.b-current-empty').hidden = scene.section.items.length > 0;
    updateEmphasis();
  }
  function draw(scene) {
    // The viewing window moves with the bands. Applying the final scroll before
    // the shape tween would make every old node jump left by one column.
    $('.b-plot').style.width = `${scene.width}px`;
    set($('.b-flow-svg'), { width: scene.width, height: scene.height, viewBox: `0 0 ${scene.width} ${scene.height}` });
    set($('.b-clip-rect'), { width: Math.max(1, scene.width - 36), height: scene.height });
    for (const [id, entry] of scene.paths) {
      const path = pathElements.get(id); path.setAttribute('d', bandPath(entry.points));
      path.style.setProperty('--b-motion-opacity', entry.opacity ?? 1);
    }
    for (const [id, entry] of scene.current) {
      const { rect, label, leader } = currentElements.get(id);
      rect.setAttribute('transform', `translate(0 ${entry.y}) scale(1 ${Math.max(0, entry.height)})`);
      rect.dataset.y = String(entry.y); rect.dataset.height = String(entry.height);
      rect.style.setProperty('--b-motion-opacity', entry.height > .01 ? entry.opacity ?? 1 : 0);
      label.style.transform = `translateY(${entry.labelY}px) translateY(-50%)`;
      label.style.setProperty('--b-motion-opacity', entry.opacity ?? 1);
      label.style.pointerEvents = entry.opacity < .08 ? 'none' : '';
      const middle = scene.barWidth + scene.leaderWidth * .48;
      leader.setAttribute('d', `M ${scene.barWidth} ${center(entry)} C ${middle} ${center(entry)} ${middle} ${entry.labelY} ${scene.barWidth + scene.leaderWidth - 1} ${entry.labelY}`);
      leader.style.setProperty('--b-motion-opacity', entry.opacity ?? 1);
    }
    for (const [index, entry] of scene.nodes) {
      const { line, button } = nodeElements.get(index); set(line, { x1: entry.x, x2: entry.x, y1: 0, y2: scene.height });
      const halfLabel = mobile.matches ? 15.5 : 31;
      const labelX = Math.max(halfLabel, Math.min(scene.width - halfLabel, entry.x));
      button.style.transform = `translateX(${labelX}px) translateX(-50%)`;
      button.style.opacity = entry.opacity ?? 1; line.style.opacity = entry.opacity ?? 1;
    }
    for (const [key, entry] of scene.merges) {
      const middle = (entry.x1 + entry.x2) / 2, path = mergeElements.get(key);
      path.setAttribute('d', `M ${entry.x1} ${entry.y1} C ${middle} ${entry.y1} ${middle} ${entry.y2} ${entry.x2} ${entry.y2}`);
      path.style.setProperty('--b-motion-opacity', entry.opacity ?? 1);
    }
    $('.b-chart-scroll').scrollLeft = scene.scrollLeft ?? 0;
  }
  const motion = createTimeMotion({ prepare, draw, reduced: () => reduced.matches,
    complete() { updateEmphasis(); },
    status(status, progress) { host.dataset.bMotion = status; host.dataset.bMotionProgress = progress.toFixed(4); $('.b-replay').disabled = !motion.canReplay; },
  });

  function makeScene(s) {
    const { layers, order, merges } = cache(s.layerId);
    const availableHeight = Math.min($('.b-current-section').clientHeight, $('.b-chart-scroll').clientHeight - AXIS_HEIGHT);
    const height = Math.max(130, Math.floor(availableHeight));
    const holderWidth = Math.max(150, $('.b-chart-scroll').clientWidth);
    const first = range === 'all' ? 0 : Math.max(0, s.index - 4), last = s.index;
    const indexes = Array.from({ length: last - first + 1 }, (_, index) => first + index);
    const width = range === 'all' ? Math.max(holderWidth, indexes.length * 90) : holderWidth;
    const step = (width - 36) / Math.max(1, indexes.length - 1);
    const xFor = index => indexes.length === 1 ? width / 2 : 18 + (index - first) * step;
    const sections = layers.map(layer => layoutSection(layer, order, height));
    const section = layoutSection(s.layer, order, height);
    const barWidth = mobile.matches ? 26 : 46, leaderWidth = mobile.matches ? 16 : 24;
    const heights = mobile.matches ? measureLabels(section.items, $('.b-current-section').getBoundingClientRect().width - barWidth - leaderWidth) : null;
    const labels = labelPositions(section.items, height, heights ? { heights } : {});
    const ids = order.filter(id => indexes.some(index => sections[index].points.get(id)?.height > 0));
    const paths = new Map(ids.map(id => {
      const item = getItem(s.state, id) || [...indexes].reverse().map(index => getItem(s.records[index].state, id)).find(Boolean);
      return [id, { id, item, color: colorFor(item, s.state), opacity: 1,
        points: indexes.map(index => ({ index, x: xFor(index), ...sections[index].points.get(id) })) }];
    }));
    const currentItems = new Map(section.items.map(point => [point.id, { ...point, labelY: labels.get(point.id), color: colorFor(point.item, s.state), opacity: 1, active: true }]));
    const mergeMap = new Map(merges.filter(link => link.index > first && link.index <= last).map(link => {
      const source = sections[link.index - 1].points.get(link.from), target = sections[link.index].points.get(link.to);
      return [`${link.index}:${link.from}:${link.to}`, { ...link, x1: xFor(link.index - 1), y1: center(source), x2: xFor(link.index), y2: center(target), opacity: 1 }];
    }));
    return { index: s.index, layerId: s.layerId, first, last, width, height, section, sections, order, paths, current: currentItems, xFor,
      nodes: new Map(indexes.map(index => [index, { index, x: xFor(index), opacity: 1, active: true }])), merges: mergeMap,
      scrollLeft: $('.b-chart-scroll').scrollLeft,
      barWidth, leaderWidth };
  }

  function renderBreadcrumbs(s) {
    $('.b-breadcrumbs').innerHTML = `${s.layerId ? '<button class="b-rise" data-b-action="rise" aria-label="返回上层">↑</button>' : ''}<button data-b-action="root" ${s.layerId ? '' : 'aria-current="page"'}>全部事项</button>${s.path.map((item, index) => `<span aria-hidden="true">/</span><button data-b-dive="${esc(item.id)}" title="${esc(item.title)}" ${index === s.path.length - 1 ? 'aria-current="page"' : ''}>${esc(item.title)}</button>`).join('')}`;
  }
  function diffHTML(s) {
    const ids = new Set([...s.layer.items, ...s.baseLayer.items].map(item => item.id));
    const changes = s.diff.changes.filter(change => ids.has(change.item));
    return `<div class="b-diff"><div class="b-diff-heading"><label>比较起点<select aria-label="比较起点">${s.frames.slice(0, s.index + 1).map((frame, index) => `<option value="${index}" ${index === s.baseIndex ? 'selected' : ''}>${esc(frameName(frame, index))}</option>`).join('')}</select></label><p>与 ${formatDate(s.now)} ${formatTime(s.now)} 比较</p><button data-lab-inspect="diff">完整差异 ↗</button></div>${changes.length ? `<div class="b-change-list">${changes.map(change => {
      const item = getItem(s.state, change.item) || getItem(s.baseState, change.item);
      const before = getItem(s.baseState, change.item), after = getItem(s.state, change.item);
      const allocation = change.fields.includes('share') && before?.status === 'active' && after?.status === 'active' && before.share !== after.share ? ` · ${before.share} → ${after.share} 份` : '';
      return `<button data-b-item="${esc(change.item)}"><small>${CHANGE_NAMES[change.type] || change.type}${allocation}</small><span>${esc(item?.title || change.item)}</span></button>`;
    }).join('')}</div>` : '<p class="b-no-change">当前层没有内容变化，事项份额保持不变。</p>'}</div>`;
  }
  function renderReader(s, force = false) {
    const stamp = `${s.index}|${s.layerId}|${s.selectedId}|${readerMode}|${s.baseIndex}|${s.state.event_seq}`;
    if (!force && stamp === readerStamp) return;
    readerStamp = stamp;
    const selected = s.selectedItem;
    $('.b-reader-actions [data-b-action="overview"]').hidden = !selected && readerMode === 'overview';
    let title = '本轮判断', content = '';
    if (readerMode === 'feedback') {
      title = '待确认反馈';
      const annotations = s.state.pending_annotations ?? [];
      content = annotations.length ? `<div class="b-feedback-list">${annotations.map(annotation => {
        const id = annotation.item ?? annotation.item_id, item = getItem(s.state, id);
        return `<article><p>${esc(annotation.text)}</p><footer>${esc(annotation.author || '用户')} · 已保存 · 待确认反馈</footer><button data-b-item="${esc(id)}">${esc(item?.title || id)}${item?.status !== 'active' ? '（历史事项）' : ''} ↗</button></article>`;
      }).join('')}</div>` : '<p>暂无待确认反馈。</p>';
    } else if (readerMode === 'story') {
      title = '演示说明';
      content = `<div class="b-story"><p>${esc(s.scenario.persona.context)}</p><h3>公开资料</h3>${s.scenario.publicSources.map(source => `<article><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a><p>${esc(source.usedFor)}</p></article>`).join('')}</div>`;
    } else if (readerMode === 'diff') { title = '前后变化'; content = diffHTML(s); }
    else if (selected) {
      title = '事项详情';
      content = (selected.status === 'active' ? '' : `<p class="b-history-notice">${selected.status === 'merged' ? '该事项已合并' : '该事项已撤下'}，以下是保留的历史，不占用此刻的预算。</p>`) + detailHTML(s, selected.id);
    } else {
      content = `<p class="b-narrative">${esc(s.frame.narrative)}</p><div class="b-summary-meta">${s.layerId ? '当前子层独立使用 64 份' : '本轮事项摘要与整理依据。'}</div>`;
      const mergeGroups = new Map();
      for (const link of cache(s.layerId).merges.filter(link => link.index === s.index)) {
        if (!mergeGroups.has(link.to)) mergeGroups.set(link.to, { ...link, sources: [] });
        mergeGroups.get(link.to).sources.push(link.source.title);
      }
      content += [...mergeGroups.values()].map(link => `<button class="b-merge-note" data-b-item="${esc(link.to)}"><small>本轮合并了 ${link.sources.length} 个事项</small><span>${esc(link.target.title)} ↗</span><p>${esc(link.target.reason)}</p></button>`).join('');
      content += s.layer.items.length ? `<div class="b-reading-list">${s.layer.items.map(item => `<article class="b-reading-row" data-b-focus-id="${esc(item.id)}"><div class="b-reading-title"><button data-b-item="${esc(item.id)}" style="--item-color:${colorFor(item, s.state)}"><span class="b-item-dot" aria-hidden="true"></span>${esc(item.title)}</button><span>${item.share} 份 · ${kindLabel[item.kind]}</span></div><p>${esc(item.summary)}</p><div class="b-row-links"><button data-b-item="${esc(item.id)}">依据${item.annotations?.length ? '与反馈' : ''} ↗</button>${item.children?.items.length ? `<button data-b-dive="${esc(item.id)}">${item.children.items.length} 个子项 ↗</button>` : ''}</div></article>`).join('')}</div>` : '<div class="b-empty-reader"><p>暂无事项。</p><button data-b-action="next">查看下一次整理 →</button></div>';
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
  function render(s, event) {
    current = s;
    if (event.type === 'select' && s.selectedId) readerMode = 'item';
    if (event.type === 'compare') readerMode = s.comparing ? 'diff' : 'overview';
    if (event.type === 'dive' || event.type === 'rise') { readerMode = 'overview'; host.classList.remove('is-reading'); }
    $('.b-date').textContent = `${formatDate(s.now)} · ${formatTime(s.now)}`;
    $('#b-page-title').textContent = s.frame.title; $('#b-page-title').title = s.frame.title;
    const revision = String(s.state.revision);
    $('.b-revision').textContent = `${String(s.index + 1).padStart(2, '0')} / ${s.frames.length} · ${revision.startsWith('r') ? revision : `r${revision}`}`;
    $('.b-input-count').textContent = String(s.frame.events.length);
    $('.b-feedback-button').hidden = !s.state.pending_annotations?.length;
    $('.b-feedback-count').textContent = String(s.state.pending_annotations?.length ?? 0);
    $('.b-jump select').value = String(s.index); $('.b-scrubber input').value = String(s.index);
    $('.b-first-date').textContent = formatDate(s.frames[0].at); $('.b-last-date').textContent = formatDate(s.frames.at(-1).at);
    $('[data-b-action="previous"]').disabled = s.index === 0; $('[data-b-action="next"]').disabled = s.index === s.frames.length - 1;
    $('.b-play-word').textContent = s.playing ? '暂停' : '播放'; $('.b-play-icon').textContent = s.playing ? 'Ⅱ' : '▷';
    $('.b-play').setAttribute('aria-label', s.playing ? '暂停回放' : '播放回放'); $('.b-compare').setAttribute('aria-pressed', String(s.comparing));
    for (const button of host.querySelectorAll('[data-b-range]')) button.setAttribute('aria-pressed', String(button.dataset.bRange === range));
    renderBreadcrumbs(s); renderReader(s);
    const dimensions = `${Math.round($('.b-chart-scroll').clientWidth)}:${Math.round($('.b-current-section').clientHeight)}`;
    const stamp = `${s.index}|${s.layerId}|${s.comparing}|${s.baseIndex}|${range}|${dimensions}`;
    if (stamp !== chartStamp || event.type === 'resize') {
      hoveredId = null; focusedId = null;
      const scene = makeScene(s);
      $('.b-history-range').textContent = `${scene.first + 1}—${scene.last + 1} 次整理`;
      $('.b-budget').innerHTML = `<strong>${scene.section.used}</strong> / ${scene.section.budget} 份`;
      $('.b-blank-note').textContent = scene.section.blank ? `${scene.section.blank} 份未分配，显示为带间留白` : '64 份已全部分配';
      const checked = s.index > 0 && s.frameDiff.changes.length === 0;
      $('.b-check-note').textContent = checked ? '检查过，状态未变' : s.layerId ? '子层预算独立' : '';
      host.dataset.bContentChanged = String(!checked);
      const moving = ['frame', 'dive', 'rise', 'range'].includes(event.type);
      const scrollLeft = $('.b-chart-scroll').scrollLeft;
      scene.scrollLeft = event.type === 'range' && range === 'all' ? 0 : Math.max(0, scene.width - $('.b-chart-scroll').clientWidth);
      motion.transition(scene, { kind: event.type, anchorId: event.anchorId, instant: !moving, duration: 1600, scrollLeft });
      chartStamp = stamp;
    } else updateEmphasis();
    host.dataset.bStateIndex = String(s.index); host.dataset.bLayer = s.layerId ?? 'root';
  }
  function showReader() { if (mobile.matches) { host.classList.add('is-reading'); $('#b-reader-title').focus({ preventScroll: true }); } }
  function click(event) {
    const button = event.target.closest('button, [role="button"]');
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
    if (event.target.matches('.b-flow, .b-current-fill') && ['Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); model.select(event.target.dataset.bItem); showReader();
    }
  }
  function change(event) {
    if (event.target.matches('.b-jump select, .b-scrubber input')) model.goFrame(Number(event.target.value));
    else if (event.target.matches('.b-diff select')) model.setBase(Number(event.target.value));
  }
  const itemFrom = element => element?.closest?.('[data-b-item], [data-b-focus-id]')?.dataset.bItem ?? element?.closest?.('[data-b-focus-id]')?.dataset.bFocusId ?? null;
  function pointerover(event) { const id = itemFrom(event.target); if (id !== hoveredId) { hoveredId = id; updateEmphasis(); } }
  function pointerout(event) { const id = itemFrom(event.relatedTarget); if (id !== hoveredId) { hoveredId = id; updateEmphasis(); } }
  function focusin(event) { focusedId = itemFrom(event.target); updateEmphasis(); }
  function focusout() { queueMicrotask(() => { if (!disposed) { focusedId = itemFrom(document.activeElement); updateEmphasis(); } }); }
  const listeners = { click, keydown, change, pointerover, pointerout, focusin, focusout };
  for (const [name, listener] of Object.entries(listeners)) host.addEventListener(name, listener);
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
  observer.observe($('.b-chart-layout')); host.dataset.bBuild = 'bc-refinement-2';
  return () => {
    disposed = true; unsubscribe(); observer.disconnect(); cancelAnimationFrame(resizeFrame); motion.stop();
    for (const [name, listener] of Object.entries(listeners)) host.removeEventListener(name, listener);
    reduced.removeEventListener?.('change', reduceMotion);
  };
}

export default mount;
