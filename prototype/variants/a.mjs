import { escapeHTML as esc, formatDate, formatTime, kindLabel, getItem, getLayer, colorFor, detailHTML } from './shared.mjs?v=feedback-loop-1';
import { layoutPapers } from './a-layout.mjs';
import { createBoardMotion } from '../motion.mjs';

const FRAME_DURATION = 1400;
const LAYER_DURATION = 1600;

function mergeLinks(before, after, beforeLayer, afterLayer) {
  if (!before || !after) return [];
  const from = new Set(beforeLayer.items.map(item => item.id));
  const to = new Set(afterLayer.items.map(item => item.id));
  const follow = (id, state, visible) => {
    const history = new Map((state.historical || []).map(item => [item.id, item]));
    const visited = new Set();
    while (!visited.has(id)) {
      visited.add(id);
      const item = history.get(id);
      if (item?.status !== 'merged' || !item.merged_into) return null;
      id = item.merged_into;
      if (visible.has(id)) return id;
    }
    return null;
  };
  const links = [];
  for (const id of from) if (!to.has(id)) {
    const target = follow(id, after, to);
    if (target) links.push({ from: id, to: target });
  }
  for (const id of to) if (!from.has(id)) {
    const source = follow(id, before, from);
    if (source) links.push({ from: source, to: id });
  }
  return links;
}

export function mount(host, model) {
  let current = model.snapshot(), readerMode = null, slow = false, lastTransition = null;
  let disposed = false, resizeFrame = null, boardSize = '';
  const motion = createBoardMotion({ duration: FRAME_DURATION, easing: 'cubic-bezier(.42,0,.28,1)' });
  host.innerHTML = `<div class="a-workspace">
    <header class="a-header">
      <button class="a-wordmark" data-a-action="root" aria-label="回到全部事项">Fold<span>林苒的事项</span></button>
      <div class="a-header-tools"><button class="a-feedback" data-a-action="feedback" hidden></button><button data-lab-inspect="inputs">本轮输入 <span class="a-input-count"></span></button><button data-lab-inspect="state" class="a-data-button" aria-label="查看完整状态 JSON">{ }</button></div>
    </header>
    <main class="a-main">
      <div class="a-scene-heading"><div class="a-now"><span class="a-day"></span><span class="a-clock"></span></div><h1 class="a-frame-title"></h1></div>
      <div class="a-scope"><nav class="a-breadcrumb" aria-label="当前层级"></nav><div class="a-budget"></div></div>
      <div class="a-board-wrap"><div class="a-board" id="a-board" aria-label="当前层的注意力分配"></div><div class="a-empty" hidden><p>暂无事项</p><span>当前尚未纳入任何事项。</span><button data-a-action="first">查看首次输入 <span>→</span></button></div></div>
      <div class="a-below-board"><div class="a-small-items" aria-label="面积较小的事项"></div><button class="a-compare-toggle" data-a-action="compare" aria-pressed="false">对比变化 <span>↔</span></button></div>
      <div class="a-compare-bar" hidden><label>比较起点 <select class="a-base-select" aria-label="选择比较起点"></select></label><button data-lab-inspect="diff">核对具体变化 ↗</button><button data-a-action="compare" aria-label="结束比较">×</button></div>
      <div class="a-meaning"><p class="a-narrative"></p><button data-lab-inspect="batch" title="查看这一轮声明与回执">声明与回执 ↗</button></div>
      <footer class="a-time-controls">
        <div class="a-play-controls"><button class="a-play" data-a-action="play"></button><button class="a-step" data-a-action="previous" aria-label="上一帧">←</button><button class="a-step" data-a-action="next" aria-label="下一帧">→</button></div>
        <div class="a-timeline"><input class="a-frame-range" type="range" min="0" step="1" aria-label="选择回放帧"><div class="a-timeline-labels"><span>10月12日</span><span class="a-frame-count"></span><span>10月25日</span></div></div>
        <div class="a-motion-controls"><button data-a-action="replay" disabled>重播过渡</button><button data-a-action="slow" aria-pressed="false">慢速过渡</button></div>
      </footer>
    </main>
    <aside class="a-reader" aria-label="事项详情" hidden><div class="a-reader-top"><span>事项详情</span><button data-a-action="close" aria-label="关闭详情">×</button></div><div class="a-reader-body"></div></aside>
    <div class="a-live" role="status" aria-live="polite" aria-atomic="true"></div>
  </div>`;
  const $ = selector => host.querySelector(selector);
  const board = $('.a-board'), reader = $('.a-reader');
  const range = $('.a-frame-range'), baseSelect = $('.a-base-select');
  const textMeasure = document.createElement('canvas').getContext('2d');

  function renderReader(s) {
    if (readerMode === 'feedback') {
      const pending = s.state.pending_annotations || [];
      reader.hidden = false;
      $('.a-reader-top span').textContent = '待确认反馈';
      $('.a-reader-body').innerHTML = `<div class="a-pending-intro"><h2>${pending.length ? '待确认反馈' : '暂无待确认反馈'}</h2><p>保存下来，不等于 Agent 已确认处理，也不代表外部行动已完成。</p></div>${pending.map(annotation => {
        const item = getItem(s.state, annotation.item || annotation.item_id);
        return `<article class="a-pending"><small>${esc(annotation.author || '林苒')} · 待确认反馈</small><p>${esc(annotation.text)}</p>${item ? `<button data-shared-select="${esc(item.id)}">${esc(item.title)} <span>↗</span></button>` : ''}</article>`;
      }).join('')}`;
    } else if (s.selectedItem) {
      reader.hidden = false;
      $('.a-reader-top span').textContent = s.selectedItem.status === 'active' ? '事项详情' : '历史事项详情';
      $('.a-reader-body').innerHTML = detailHTML(s, s.selectedId);
    } else reader.hidden = true;
  }

  function renderBoard(s) {
    const width = board.clientWidth, height = board.clientHeight;
    if (!width || !height) return;
    boardSize = `${width}:${height}`;
    const layout = layoutPapers(s.layer.items, s.layer.budget, width, height);
    const diff = new Map((s.comparing ? s.diff : s.frameDiff).changes.map(change => [change.item, change]));
    const pending = new Set((s.state.pending_annotations || []).map(annotation => annotation.item || annotation.item_id));
    const small = [];
    board.dataset.used = String(s.layer.used);
    board.dataset.budget = String(s.layer.budget);
    board.dataset.blankArea = String(layout.blankArea);
    board.classList.toggle('is-full', s.layer.used === s.layer.budget);
    board.innerHTML = layout.papers.map(rect => {
      const item = getItem(s.state, rect.id);
      const tiny = rect.width < 108 || rect.height < 70;
      const compact = !tiny && (rect.width < 180 || rect.height < 150);
      const roomy = rect.width > 290 && rect.height > 190;
      let titleSize = tiny ? 12 : Math.min(rect.width < 150 ? 18 : 30, item.share >= 24 ? 30 : item.share >= 12 ? 25 : item.share >= 6 ? 20 : 16);
      const mobile = window.matchMedia('(max-width:640px)').matches;
      const paddingX = tiny ? 8 : compact ? (mobile ? 10 : 13) : roomy ? 29 : mobile ? 13 : 21;
      const paddingY = tiny ? 15 : compact ? (mobile ? 17 : 22) : roomy ? 44 : mobile ? 25 : 34;
      const kickerHeight = roomy ? 33 : compact ? 21 : 28;
      const titleLineHeight = tiny ? 1.2 : roomy ? 1.27 : compact ? 1.3 : 1.32;
      const titleRoom = Math.max(0, rect.height - paddingY - (tiny ? 0 : kickerHeight) - 24);
      const measureTitleLines = () => {
        textMeasure.font = `600 ${titleSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
        return Math.max(1, Math.ceil((textMeasure.measureText(item.title).width + 3) / Math.max(1, rect.width - paddingX * 2)));
      };
      let naturalTitleLines = measureTitleLines();
      while (!tiny && titleSize > 16 && naturalTitleLines * titleSize * titleLineHeight > titleRoom) {
        titleSize -= 1;
        naturalTitleLines = measureTitleLines();
      }
      const titleLines = Math.max(1, Math.min(tiny ? 2 : 4, Math.floor(titleRoom / (titleSize * titleLineHeight))));
      const titleHeight = Math.min(titleLines, naturalTitleLines + 1) * titleSize * titleLineHeight;
      const bodyLine = roomy ? 29.6 : compact ? 19.8 : mobile ? 20.4 : 25.2;
      const bodyMargins = roomy ? 19 : compact ? 11 : 14;
      const available = rect.height - paddingY - kickerHeight - titleHeight - 20 - bodyMargins - 3;
      const rows = tiny ? 0 : Math.max(0, Math.min(roomy ? 6 : 3, Math.floor(available / bodyLine)));
      const change = diff.get(item.id);
      const delta = change?.before?.share !== undefined && change?.after?.share !== undefined ? change.after.share - change.before.share : 0;
      const note = s.comparing && change ? delta > 0 ? '份额增加' : delta < 0 ? '份额减少' : change.type === 'added' ? '新增事项' : '内容更新' : '';
      const children = item.children?.items?.length || 0;
      if (tiny || naturalTitleLines > titleLines) small.push(item);
      return `<article class="a-paper pin-tile ${tiny ? 'is-tiny' : compact ? 'is-compact' : 'is-readable'} ${roomy ? 'is-roomy' : ''} ${rect.width < 55 || rect.height < 40 ? 'is-stub' : ''} ${s.selectedId === item.id ? 'is-selected' : ''} ${pending.has(item.id) ? 'has-feedback' : ''}" data-id="${esc(item.id)}" data-share="${item.share}" style="left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;--paper-color:${colorFor(item, s.state)};--summary-lines:${rows};--title-size:${titleSize}px;--title-lines:${titleLines}">
        <button class="a-paper-main" data-shared-select="${esc(item.id)}" aria-label="${esc(item.title)}，${kindLabel[item.kind]}，${item.share}份${pending.has(item.id) ? '，有待确认反馈' : ''}">
          <span class="a-paper-kicker"><span class="a-kind ${item.kind === 'needs-you' ? 'needs-you' : ''}">${item.kind === 'needs-you' ? '<span aria-hidden="true">↗</span> ' : ''}${kindLabel[item.kind]}</span>${pending.has(item.id) ? '<span class="a-feedback-dot" title="有待确认反馈" aria-label="有待确认反馈">●</span>' : ''}</span>
          <h2>${esc(item.title)}</h2>${rows && !tiny ? `<p class="a-paper-summary">${esc(item.summary)}</p>` : ''}
          <span class="a-paper-foot"><span class="a-share">${item.share}<span> / ${s.layer.budget}</span></span>${note ? `<span class="a-change-note">${note}</span>` : ''}</span>
        </button>${children && !tiny ? `<button class="a-paper-dive" data-shared-dive="${esc(item.id)}" aria-label="展开${esc(item.title)}的${children}个子项">${children} 个子项 <span>↗</span></button>` : ''}
      </article>`;
    }).join('');
    // Punctuation and mixed scripts may wrap differently from the width estimate.
    // Keep a complete, directly readable title below any paper that cannot fit it.
    for (const heading of board.querySelectorAll('.a-paper h2')) {
      const id = heading.closest('.a-paper').dataset.id;
      if (heading.scrollHeight > heading.clientHeight + 1 && !small.some(item => item.id === id)) small.push(getItem(s.state, id));
    }
    $('.a-empty').hidden = s.layer.items.length !== 0;
    $('.a-small-items').innerHTML = small.length ? `<span>其他事项</span>${small.map(item => `<button data-shared-select="${esc(item.id)}" style="--paper-color:${colorFor(item, s.state)}"><span class="a-small-mark" aria-hidden="true"></span>${esc(item.title)}<small>${kindLabel[item.kind]}</small>${pending.has(item.id) ? '<small>待确认反馈</small>' : ''}</button>`).join('')}` : '<span class="a-read-hint">选择事项查看摘要与依据。</span>';
  }

  function render(s, event) {
    const stateChanged = ['init', 'frame', 'dive', 'rise', 'compare'].includes(event.type);
    const before = stateChanged && event.type !== 'init' ? motion.capture([board]) : null;
    if (!stateChanged && event.type !== 'play') motion.cancel('selection');
    if (event.type === 'select') readerMode = null;
    current = s;
    $('.a-day').textContent = formatDate(s.now);
    $('.a-clock').textContent = formatTime(s.now);
    $('.a-frame-title').textContent = s.layerId ? getItem(s.state, s.layerId).title : s.frame.title;
    $('.a-breadcrumb').innerHTML = `<button data-a-action="root" ${s.layerId ? '' : 'aria-current="page"'}>全部事项</button>${s.path.map(item => `<span aria-hidden="true">/</span><button data-shared-dive="${esc(item.id)}" ${item.id === s.layerId ? 'aria-current="page"' : ''}>${esc(item.title)}</button>`).join('')}`;
    $('.a-budget').innerHTML = `<span>${s.layer.items.length} 件事</span><b>${s.layer.used}<small> / ${s.layer.budget}</small></b>`;
    $('.a-input-count').textContent = s.frame.events.length ? ` ${s.frame.events.length}` : '';
    const pending = s.state.pending_annotations?.length || 0;
    const feedback = $('.a-feedback');
    feedback.hidden = pending === 0;
    feedback.textContent = `${pending} 条待确认反馈`;
    $('.a-narrative').textContent = s.frame.narrative;
    $('.a-play').textContent = s.playing ? 'Ⅱ 暂停' : '▶ 播放';
    $('[data-a-action="previous"]').disabled = s.index === 0;
    $('[data-a-action="next"]').disabled = s.index === s.frames.length - 1;
    range.max = s.frames.length - 1;
    range.value = s.index;
    range.style.setProperty('--progress', `${s.index / (s.frames.length - 1) * 100}%`);
    $('.a-frame-count').textContent = `${s.index + 1} / ${s.frames.length}`;
    $('.a-compare-toggle').setAttribute('aria-pressed', String(s.comparing));
    $('.a-compare-bar').hidden = !s.comparing;
    baseSelect.innerHTML = s.frames.slice(0, s.index + 1).map((frame, index) => `<option value="${index}" ${index === s.baseIndex ? 'selected' : ''}>${formatDate(frame.at)} ${formatTime(frame.at)} · ${esc(frame.title)}</option>`).join('');
    if (event.type !== 'play') renderBoard(s);
    renderReader(s);
    if (event.type === 'frame' || event.type === 'dive' || event.type === 'rise') $('.a-live').textContent = `${$('.a-frame-title').textContent}，当前${s.layer.items.length}件事，占${s.layer.used}份。`;
    if (before) {
      const previous = event.previous;
      const options = { kind: event.type === 'dive' || event.type === 'rise' ? event.type : 'frame', anchorId: event.anchorId,
        boards: [board], links: previous ? mergeLinks(previous.state, s.state, previous.layer, s.layer) : [],
        duration: (event.type === 'dive' || event.type === 'rise' ? LAYER_DURATION : FRAME_DURATION) * (slow ? 1.8 : 1),
        contentChanged: event.type === 'compare' || event.type === 'dive' || event.type === 'rise' || (previous?.state.revision !== s.state.revision) };
      lastTransition = { before, options };
      $('[data-a-action="replay"]').disabled = false;
      motion.transition(before, options);
    }
  }

  function closeReader() {
    const selected = current.selectedId;
    readerMode = null; model.select(null);
    const target = selected && board.querySelector(`[data-id="${CSS.escape(selected)}"] .a-paper-main`);
    (target || $('[data-a-action="root"]')).focus({ preventScroll: true });
  }
  function onKeyDown(event) {
    if (event.key !== 'Escape' || reader.hidden || !document.getElementById('lab-inspector')?.hidden || !document.getElementById('lab-about')?.hidden) return;
    event.preventDefault(); event.stopImmediatePropagation(); closeReader();
  }
  function click(event) {
    const target = event.target.closest('[data-a-action]');
    if (!target || !host.contains(target)) return;
    const action = target.dataset.aAction;
    if (action === 'root') model.goRoot();
    else if (action === 'first') model.goFrame(1);
    else if (action === 'previous') model.goFrame(current.index - 1);
    else if (action === 'next') model.goFrame(current.index + 1);
    else if (action === 'play') model.togglePlay();
    else if (action === 'compare') model.setCompare(!current.comparing);
    else if (action === 'slow') {
      slow = !slow; target.setAttribute('aria-pressed', String(slow));
      target.textContent = slow ? '慢速过渡中' : '慢速过渡';
    } else if (action === 'replay' && lastTransition) {
      model.pause();
      motion.transition(lastTransition.before, { ...lastTransition.options, duration: (lastTransition.options.kind === 'frame' ? FRAME_DURATION : LAYER_DURATION) * (slow ? 1.8 : 1) });
    } else if (action === 'feedback') {
      model.pause(); readerMode = 'feedback'; renderReader(current);
    } else if (action === 'close') {
      closeReader();
    }
  }
  const onRange = event => model.goFrame(Number(event.target.value));
  const onBase = event => model.setBase(Number(event.target.value));
  host.addEventListener('click', click);
  document.addEventListener('keydown', onKeyDown, true);
  range.addEventListener('input', onRange);
  baseSelect.addEventListener('change', onBase);
  const observer = new ResizeObserver(() => {
    if (disposed || boardSize === `${board.clientWidth}:${board.clientHeight}`) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (disposed) return;
      motion.cancel('resize'); lastTransition = null;
      $('[data-a-action="replay"]').disabled = true;
      renderBoard(current);
    });
  });
  observer.observe(board);
  const unsubscribe = model.subscribe(render);
  // Read-only inspection makes the encoded area directly checkable in the lab.
  host.foldPaperInspection = () => ({ layerId: current.layerId, used: current.layer.used, budget: current.layer.budget,
    ...layoutPapers(current.layer.items, current.layer.budget, board.clientWidth, board.clientHeight), motion: motion.inspect() });
  return () => {
    disposed = true; unsubscribe(); observer.disconnect(); cancelAnimationFrame(resizeFrame);
    motion.cancel('unmount'); host.removeEventListener('click', click);
    document.removeEventListener('keydown', onKeyDown, true);
    range.removeEventListener('input', onRange); baseSelect.removeEventListener('change', onBase);
    delete host.foldPaperInspection;
  };
}
