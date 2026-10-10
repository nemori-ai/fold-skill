import { escapeHTML as esc, formatDate, formatTime, kindLabel, getItem, colorFor, detailHTML, currentAsk, feedbackTrail } from './shared.mjs?v=feedback-loop-1';
import { layoutPapers } from './a-layout.mjs';
import { createBoardMotion } from '../motion.mjs';

const FRAME_DURATION = 1400;
const LAYER_DURATION = 1600;
// Expectations come from the host-side ask registered for this output version
// (docs/domain-model.md). kind alone never implies a usable way to respond.
const expectWord = { decide: '决定', input: '提供', act: '去做' };
const expectLabel = expects => `需要你${expects.map(value => expectWord[value] || value).join('、')}`;
const replyWord = { decide: '回应了决定', input: '提供了内容', act: '报告已做', ack: '已阅', snooze: '稍后提醒' };

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

const sameText = (a, b) => { const norm = value => String(value).replace(/[\s，。？?、：:]/g, ''); return norm(b).includes(norm(a)) || norm(a).includes(norm(b)); };
const stamp = value => `${formatDate(value)} ${formatTime(value)}`;
function windowText(window) {
  if (!window) return '';
  const same = formatDate(window.from) === formatDate(window.to);
  return `${stamp(window.from)} – ${same ? formatTime(window.to) : stamp(window.to)}`;
}

// The label of the registered action a reply answered, looked up in earlier asks.
function actionLabel(s, link) {
  if (link.meaning === 'ack') return '收下';
  if (link.meaning === 'snooze') return link.until ? `${formatTime(link.until)} 再提醒` : '稍后提醒';
  for (let index = s.index; index >= 0; index -= 1) {
    const action = s.frames[index].asks?.[link.target]?.actions?.find(entry => entry.id === link.action);
    if (action) return link.value !== undefined ? `${action.label}：${link.value}` : action.label;
  }
  return link.value !== undefined ? String(link.value) : replyWord[link.meaning] || '回应';
}

// Responses and due reminders that arrived in this round, each tied to the item it answers.
function roundResponses(s) {
  const responses = [];
  for (const event of s.frame.events) {
    for (const link of event.feedback || []) responses.push({ kind: 'reply', event, target: link.target, link });
    if (event.reminder) responses.push({ kind: 'reminder', event, target: event.reminder.target });
  }
  return responses;
}
// The paper in the current layer that carries an item: itself or its nearest visible ancestor.
function paperFor(s, id) {
  const visible = new Set(s.layer.items.map(item => item.id));
  const seen = new Set();
  let node = getItem(s.state, id);
  while (node && !seen.has(node.id)) {
    if (visible.has(node.id)) return node.id;
    seen.add(node.id);
    node = node.parent_id ? getItem(s.state, node.parent_id) : null;
  }
  return null;
}

export function mount(host, model) {
  let current = model.snapshot(), readerMode = null, slow = false, lastTransition = null;
  let disposed = false, resizeFrame = null, boardSize = '', baseOpen = false, baseActive = 0, dragging = false;
  const motion = createBoardMotion({ duration: FRAME_DURATION, easing: 'cubic-bezier(.42,0,.28,1)' });
  host.innerHTML = `<div class="a-workspace">
    <header class="a-header">
      <button class="a-wordmark" data-a-action="root" aria-label="回到全部事项">Fold<span>林苒的事项</span></button>
      <div class="a-header-tools"><button class="a-feedback" data-a-action="feedback" hidden></button><button data-lab-inspect="inputs">原始输入</button><button data-lab-inspect="state" class="a-data-button" aria-label="查看完整状态 JSON">{ }</button></div>
    </header>
    <main class="a-main">
      <div class="a-scene-heading"><div class="a-now"><span class="a-day"></span><span class="a-clock"></span></div><h1 class="a-frame-title"></h1></div>
      <div class="a-round" aria-label="本轮调用"></div>
      <div class="a-scope"><nav class="a-breadcrumb" aria-label="当前层级"></nav><div class="a-budget"></div></div>
      <div class="a-board-wrap"><div class="a-board" id="a-board" aria-label="当前层的注意力分配"></div><div class="a-empty" hidden><p>暂无事项</p><span>当前尚未纳入任何事项。</span><button data-a-action="first">查看首次输入 <span>→</span></button></div></div>
      <div class="a-below-board"><div class="a-small-items" aria-label="小纸片的完整标题"></div><button class="a-compare-toggle" data-a-action="compare" aria-pressed="false">对比变化 <span aria-hidden="true">↔</span></button></div>
      <div class="a-compare-bar" hidden>
        <span class="a-base-label" id="a-base-label">比较起点</span>
        <div class="a-base"><button class="a-base-button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="a-base-label a-base-value"><span id="a-base-value"></span><span class="a-caret" aria-hidden="true"></span></button><ul class="a-base-list" role="listbox" tabindex="-1" aria-labelledby="a-base-label" hidden></ul></div>
        <button data-lab-inspect="diff">核对具体变化 ↗</button><button class="a-compare-close" data-a-action="compare" aria-label="结束比较">×</button>
      </div>
      <div class="a-meaning"><p class="a-narrative"></p><button data-lab-inspect="batch" title="查看这一轮声明与回执">声明与回执 ↗</button></div>
      <footer class="a-time-controls">
        <div class="a-play-controls"><button class="a-play" data-a-action="play"></button><button class="a-step" data-a-action="previous" aria-label="上一帧">←</button><button class="a-step" data-a-action="next" aria-label="下一帧">→</button></div>
        <div class="a-timeline"><div class="a-slider" role="slider" tabindex="0" aria-label="选择回放帧" aria-valuemin="1"><div class="a-slider-track"><div class="a-slider-fill"></div></div><div class="a-slider-thumb"></div></div><div class="a-timeline-labels"><span>10月12日</span><span class="a-frame-count"></span><span>10月25日</span></div></div>
        <div class="a-motion-controls"><button data-a-action="replay" disabled>重播过渡</button><button data-a-action="slow" aria-pressed="false">慢速过渡</button></div>
      </footer>
    </main>
    <aside class="a-reader" aria-label="事项详情" hidden><div class="a-reader-top"><span>事项详情</span><button data-a-action="close" aria-label="关闭详情">×</button></div><div class="a-reader-body"></div></aside>
    <div class="a-live" role="status" aria-live="polite" aria-atomic="true"></div>
  </div>`;
  const $ = selector => host.querySelector(selector);
  const board = $('.a-board'), reader = $('.a-reader'), slider = $('.a-slider');
  const baseButton = $('.a-base-button'), baseList = $('.a-base-list');

  function loopHTML(s, id) {
    const item = getItem(s.state, id);
    if (!item) return '';
    const ask = currentAsk(s, id);
    const trail = feedbackTrail(s, id);
    if (!ask && !trail.length && item.kind !== 'needs-you') return '';
    const askPart = ask
      ? `<div class="a-loop-ask"><small>${expectLabel(ask.expects)} · 本版已登记回应方式</small><p>${esc(ask.prompt)}</p><div class="a-loop-actions">${ask.actions.map(action => `<span>${esc(action.label)}</span>`).join('')}</div><small>回应方式只作展示，这里不会提交。</small></div>`
      : item.kind === 'needs-you' ? '<p class="a-loop-none">这一版没有登记回应路径：Agent 改写事项后没有重新登记，暂时无法从这里回传。</p>' : '';
    const trailPart = trail.length ? `<ol class="a-loop-trail">${trail.map(({ event, links, frameIndex }) => {
      const label = event.reminder ? '到点提醒' : links.map(link => `${link.via === 'button' ? '按钮' : '回复'} · ${actionLabel({ ...s, index: frameIndex }, link)}`).join('；');
      return `<li${frameIndex === s.index ? ' class="is-now"' : ''}><div><time>${esc(stamp(event.at))}</time><b>${esc(label)}</b></div><p>${esc(event.text)}</p></li>`;
    }).join('')}</ol>` : '';
    return `<section class="a-loop"><h3>反馈回路</h3>${askPart}${trailPart}</section>`;
  }

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
      const detail = detailHTML(s, s.selectedId), loop = loopHTML(s, s.selectedId);
      const marker = '<p class="shared-summary">';
      const at = detail.indexOf(marker), end = at < 0 ? -1 : detail.indexOf('</p>', at);
      $('.a-reader-body').innerHTML = end < 0 ? detail + loop : detail.slice(0, end + 4) + loop + detail.slice(end + 4);
    } else reader.hidden = true;
  }

  function renderRound(s) {
    const signal = s.frame.signal;
    const round = $('.a-round');
    if (!signal) { round.innerHTML = '<span class="a-round-meta">尚无输入：Fold 还没有被调用。</span>'; return; }
    if (signal.type === 'review') {
      round.innerHTML = `<span class="a-round-kind">零事件整理</span><span class="a-round-meta">${esc(signal.reason)} · 窗口 ${esc(windowText(signal.window))} · ${signal.received} 条新输入</span><span class="a-round-meta">覆盖：${esc(signal.coverage || '未说明')}</span>`;
      return;
    }
    // One entry per answered item, so several replies to the same paper read as one line.
    const groups = new Map();
    for (const response of roundResponses(s)) {
      if (!groups.has(response.target)) groups.set(response.target, []);
      groups.get(response.target).push(response);
    }
    round.innerHTML = `<span class="a-round-meta">${signal.received} 条输入 · 窗口 ${esc(windowText(signal.window))}${signal.reason ? ` · ${esc(signal.reason)}` : ''}</span>${[...groups].map(([id, list]) => {
      const target = getItem(s.state, id), paper = paperFor(s, id);
      const what = list.map(response => response.kind === 'reminder' ? '<span class="a-response-mark" aria-hidden="true">◷</span>到点提醒'
        : `<span class="a-response-mark" aria-hidden="true">↩</span>${esc(response.event.from || '林苒')}${response.link.via === 'button' ? '按了' : '回复'}「${esc(actionLabel(s, response.link))}」`).join('<span class="a-response-sep" aria-hidden="true">，</span>');
      return `<button class="a-response" data-shared-select="${esc(id)}" ${paper ? `data-a-paper="${esc(paper)}"` : ''} title="${esc(list.map(response => response.event.text).join('\n'))}">${what}<span class="a-response-target">→ ${esc(target?.title || id)}</span></button>`;
    }).join('')}`;
  }

  // Fit each paper's text by measuring the rendered DOM: drop the summary first,
  // then the registered question, then shrink and clamp the title.
  function fitPaper(paper) {
    const main = paper.querySelector('.a-paper-main');
    // Measure with the rank label present; removing it afterwards only frees space.
    paper.classList.add('has-label');
    const overflow = () => main.scrollHeight > main.clientHeight + 1;
    const summary = paper.querySelector('.a-paper-summary');
    const ask = paper.querySelector('.a-paper-ask');
    const title = paper.querySelector('h2');
    if (summary) {
      let lines = Number(paper.style.getPropertyValue('--summary-lines')) || 4;
      while (overflow() && lines > 1) paper.style.setProperty('--summary-lines', String(--lines));
      if (overflow()) summary.remove();
    }
    if (ask && overflow()) { paper.style.setProperty('--ask-lines', '1'); if (overflow()) ask.remove(); }
    if (!title || paper.classList.contains('is-stub')) return false;
    let size = parseFloat(paper.style.getPropertyValue('--title-size'));
    const floor = paper.classList.contains('is-tiny') ? 12 : 14;
    while (overflow() && size > floor) paper.style.setProperty('--title-size', `${--size}px`);
    let lines = 4;
    paper.style.setProperty('--title-lines', String(lines));
    while (overflow() && lines > 1) paper.style.setProperty('--title-lines', String(--lines));
    if (overflow()) {
      // Still too small: keep the share and the registered expectation, list the title below.
      title.hidden = true;
      if (overflow()) paper.querySelector('.a-paper-kicker')?.setAttribute('hidden', '');
      return true;
    }
    return title.scrollHeight > title.clientHeight + 1;
  }

  function renderBoard(s) {
    const width = board.clientWidth, height = board.clientHeight;
    if (!width || !height) return;
    boardSize = `${width}:${height}`;
    const layout = layoutPapers(s.layer.items, s.layer.budget, width, height);
    const diff = new Map((s.comparing ? s.diff : s.frameDiff).changes.map(change => [change.item, change]));
    const pending = new Set((s.state.pending_annotations || []).map(annotation => annotation.item || annotation.item_id));
    const responses = new Map();
    for (const response of roundResponses(s)) {
      const paper = paperFor(s, response.target);
      if (paper && !responses.has(paper)) responses.set(paper, response);
    }
    const mobile = window.matchMedia('(max-width:640px)').matches;
    board.dataset.used = String(s.layer.used);
    board.dataset.budget = String(s.layer.budget);
    board.dataset.blankArea = String(layout.blankArea);
    board.classList.toggle('is-full', s.layer.used === s.layer.budget);
    board.innerHTML = layout.papers.map(rect => {
      const item = getItem(s.state, rect.id);
      const ask = currentAsk(s, item.id);
      const stub = rect.width < 64 || rect.height < 40;
      const tiny = !stub && (rect.width < 132 || rect.height < 100);
      const compact = !stub && !tiny && (rect.width < 210 || rect.height < 170);
      const roomy = rect.width > 300 && rect.height > 230;
      const size = stub ? 'is-stub' : tiny ? 'is-tiny' : compact ? 'is-compact' : roomy ? 'is-readable is-roomy' : 'is-readable';
      const base = item.share >= 24 ? 30 : item.share >= 12 ? 24 : item.share >= 6 ? 19 : item.share >= 3 ? 15 : 13;
      const titleSize = Math.min(base, tiny ? 13 : rect.width < 170 ? 16 : rect.width < 240 ? 20 : 30) - (mobile && base > 16 ? 2 : 0);
      const change = diff.get(item.id);
      const delta = change?.before?.share !== undefined && change?.after?.share !== undefined ? change.after.share - change.before.share : 0;
      const note = s.comparing && change ? delta ? `份额 ${change.before.share}→${change.after.share}` : change.type === 'added' ? '新增' : '内容更新' : '';
      const children = item.children?.items?.length || 0;
      const response = responses.get(item.id);
      const responseText = response ? response.kind === 'reminder' ? '◷ 到点提醒' : `↩ ${replyWord[response.link.meaning] || '本轮回应'}` : '';
      const kicker = ask ? `<span class="a-expect">${expectLabel(ask.expects)}</span>`
        : `<span class="a-kind">${kindLabel[item.kind]}${item.kind === 'needs-you' ? ' · 未登记回应' : ''}</span>`;
      const label = [item.title, ask ? `${expectLabel(ask.expects)}：${ask.prompt}` : kindLabel[item.kind], `${item.share}份`,
        responseText ? (response.kind === 'reminder' ? '本轮有到点提醒' : '本轮收到回应') : '', pending.has(item.id) ? '有待确认反馈' : ''].filter(Boolean).join('，');
      const summaryLines = roomy ? 4 : compact ? 2 : 3;
      return `<article class="a-paper pin-tile ${size} ${ask ? 'has-ask' : ''} ${response ? 'has-response' : ''} ${s.selectedId === item.id ? 'is-selected' : ''}" data-id="${esc(item.id)}" data-share="${item.share}" style="left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;--paper-color:${colorFor(item, s.state)};--summary-lines:${summaryLines};--title-size:${titleSize}px;--title-lines:4">
        <button class="a-paper-main" data-shared-select="${esc(item.id)}" aria-label="${esc(label)}">
          <span class="a-paper-kicker${tiny && ask ? ' is-kept' : ''}">${kicker}${responseText ? `<span class="a-paper-response">${responseText}</span>` : pending.has(item.id) ? '<span class="a-paper-pending">待确认反馈</span>' : ''}</span>
          <h2>${esc(item.title)}</h2>${ask && !tiny && !sameText(ask.prompt, item.title) ? `<p class="a-paper-ask">${esc(ask.prompt)}</p>` : ''}${!tiny ? `<p class="a-paper-summary">${esc(item.summary)}</p>` : ''}
          <span class="a-paper-foot"><span class="a-rank" aria-hidden="true">${rect.rank ?? ''}</span><span class="a-share">${item.share}<span> 份</span></span>${response ? `<span class="a-foot-response" aria-hidden="true">${response.kind === 'reminder' ? '◷' : '↩'}</span>` : ''}${note ? `<span class="a-change-note">${note}</span>` : ''}</span>
        </button>${children && !stub && (!tiny || rect.width >= 150) ? `<button class="a-paper-dive" data-shared-dive="${esc(item.id)}" aria-label="展开${esc(item.title)}的${children}个子项">${children} 个子项 <span aria-hidden="true">↗</span></button>` : ''}
      </article>`;
    }).join('');
    // Any paper that cannot show its whole title gets its rank number as an
    // alternative label, and the full title is listed below the board.
    const small = [];
    for (const paper of board.querySelectorAll('.a-paper')) {
      const clipped = paper.classList.contains('is-stub') || fitPaper(paper);
      paper.classList.toggle('has-label', clipped);
      if (clipped) small.push(getItem(s.state, paper.dataset.id));
    }
    $('.a-empty').hidden = s.layer.items.length !== 0;
    $('.a-small-items').innerHTML = small.length ? `<span class="a-small-head">小纸片</span>${small.map(item => {
      const ask = currentAsk(s, item.id);
      return `<button data-shared-select="${esc(item.id)}" data-a-paper="${esc(item.id)}" class="${ask ? 'has-ask' : ''}"><span class="a-small-rank">${item.rank}</span>${esc(item.title)}<small>${ask ? expectLabel(ask.expects) : `${item.share} 份`}</small></button>`;
    }).join('')}` : '<span class="a-read-hint">选择纸片查看摘要、依据与反馈回路。</span>';
  }

  function baseLabel(s, index) {
    const frame = s.frames[index];
    return `${formatDate(frame.at)} ${formatTime(frame.at)} · ${frame.title}`;
  }
  function renderBaseList() {
    const s = current;
    baseList.innerHTML = s.frames.slice(0, s.index + 1).map((frame, index) => `<li role="option" id="a-base-${index}" data-index="${index}" aria-selected="${index === s.baseIndex}" class="${index === baseActive ? 'is-active' : ''}"><time>${esc(formatDate(frame.at))} ${esc(formatTime(frame.at))}</time><span>${esc(frame.title)}</span></li>`).join('');
    baseList.setAttribute('aria-activedescendant', `a-base-${baseActive}`);
    baseList.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }
  function setBaseOpen(open, focusButton = false) {
    baseOpen = open;
    baseButton.setAttribute('aria-expanded', String(open));
    baseList.hidden = !open;
    if (open) { baseActive = current.baseIndex; renderBaseList(); baseList.focus({ preventScroll: true }); }
    else if (focusButton) baseButton.focus({ preventScroll: true });
  }
  function moveBase(index) {
    baseActive = Math.max(0, Math.min(current.index, index));
    baseList.querySelectorAll('[role="option"]').forEach(option => option.classList.toggle('is-active', Number(option.dataset.index) === baseActive));
    baseList.setAttribute('aria-activedescendant', `a-base-${baseActive}`);
    baseList.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }
  function chooseBase(index) {
    setBaseOpen(false, true);
    if (index !== current.baseIndex) model.setBase(index);
  }

  function renderSlider(s) {
    const last = s.frames.length - 1;
    slider.setAttribute('aria-valuemax', String(s.frames.length));
    slider.setAttribute('aria-valuenow', String(s.index + 1));
    slider.setAttribute('aria-valuetext', `第 ${s.index + 1} 帧，共 ${s.frames.length} 帧：${stamp(s.frame.at)}，${s.frame.title}`);
    slider.style.setProperty('--progress', `${s.index / last * 100}%`);
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
    $('.a-breadcrumb').innerHTML = `<button data-a-action="root" ${s.layerId ? '' : 'aria-current="page"'}>全部事项</button>${s.path.map(item => `<span aria-hidden="true">/</span><button data-shared-dive="${esc(item.id)}" ${item.id === s.layerId ? 'aria-current="page"' : ''}>${esc(item.title)}</button>`).join('')}${s.layerId ? '<span class="a-scope-note">子层独立 64 份</span>' : ''}`;
    const asking = s.layer.items.filter(item => currentAsk(s, item.id)).length;
    $('.a-budget').innerHTML = `<span>${s.layer.items.length} 件${asking ? `，<em>${asking} 件需要你</em>` : ''}</span><b>${s.layer.used}<small> / ${s.layer.budget} 份</small></b>`;
    const pending = s.state.pending_annotations?.length || 0;
    const feedback = $('.a-feedback');
    feedback.hidden = pending === 0;
    feedback.textContent = `${pending} 条待确认反馈`;
    renderRound(s);
    const review = s.frame.signal?.type === 'review';
    $('.a-narrative').innerHTML = `${review ? '<b>这次整理的结果</b>' : ''}${esc(s.frame.narrative)}`;
    $('.a-play').textContent = s.playing ? 'Ⅱ 暂停' : '▶ 播放';
    $('[data-a-action="previous"]').disabled = s.index === 0;
    $('[data-a-action="next"]').disabled = s.index === s.frames.length - 1;
    renderSlider(s);
    $('.a-frame-count').textContent = `${s.index + 1} / ${s.frames.length}`;
    $('.a-compare-toggle').setAttribute('aria-pressed', String(s.comparing));
    $('.a-compare-bar').hidden = !s.comparing;
    $('#a-base-value').textContent = baseLabel(s, s.baseIndex);
    if (baseOpen) { if (!s.comparing) setBaseOpen(false); else renderBaseList(); }
    if (event.type !== 'play') renderBoard(s);
    renderReader(s);
    if (event.type === 'frame' || event.type === 'dive' || event.type === 'rise') $('.a-live').textContent = `${$('.a-frame-title').textContent}，当前${s.layer.items.length}件事，占${s.layer.used}份${asking ? `，${asking}件需要你` : ''}。`;
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
    if (event.key !== 'Escape' || baseOpen || reader.hidden || !document.getElementById('lab-inspector')?.hidden || !document.getElementById('lab-about')?.hidden) return;
    event.preventDefault(); event.stopImmediatePropagation(); closeReader();
  }
  function click(event) {
    if (baseOpen && !event.target.closest('.a-base')) setBaseOpen(false);
    const option = event.target.closest('.a-base-list [role="option"]');
    if (option) { chooseBase(Number(option.dataset.index)); return; }
    if (event.target.closest('.a-base-button')) { setBaseOpen(!baseOpen, !baseOpen ? false : true); return; }
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
  // Hovering or focusing a response or a small-paper label points at its paper.
  function link(event) {
    const source = event.target.closest?.('[data-a-paper]');
    board.querySelectorAll('.a-paper.is-linked').forEach(paper => paper.classList.remove('is-linked'));
    if (source && (event.type === 'pointerover' || event.type === 'focusin')) {
      board.querySelector(`.a-paper[data-id="${CSS.escape(source.dataset.aPaper)}"]`)?.classList.add('is-linked');
    }
  }

  // Custom frame slider: pointer drag plus the standard slider keys.
  const frameAt = clientX => {
    const box = slider.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * (current.frames.length - 1));
  };
  const goTo = index => { if (index !== current.index) model.goFrame(index); };
  function onSliderDown(event) {
    if (event.button !== 0) return;
    dragging = true; slider.setPointerCapture(event.pointerId); slider.classList.add('is-dragging');
    slider.focus({ preventScroll: true }); goTo(frameAt(event.clientX)); event.preventDefault();
  }
  const onSliderMove = event => { if (dragging) goTo(frameAt(event.clientX)); };
  const onSliderUp = () => { dragging = false; slider.classList.remove('is-dragging'); };
  function onSliderKey(event) {
    const last = current.frames.length - 1;
    const next = { ArrowLeft: current.index - 1, ArrowDown: current.index - 1, ArrowRight: current.index + 1, ArrowUp: current.index + 1,
      PageDown: current.index - 5, PageUp: current.index + 5, Home: 0, End: last }[event.key];
    if (next === undefined || event.altKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault(); event.stopPropagation();
    goTo(Math.max(0, Math.min(last, next)));
  }
  function onBaseKey(event) {
    const keys = { ArrowDown: baseActive + 1, ArrowUp: baseActive - 1, Home: 0, End: current.index, PageDown: baseActive + 8, PageUp: baseActive - 8 };
    if (event.key in keys) { event.preventDefault(); event.stopPropagation(); moveBase(keys[event.key]); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); chooseBase(baseActive); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setBaseOpen(false, true); }
    else if (event.key === 'Tab') setBaseOpen(false);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') event.stopPropagation();
  }
  function onBaseButtonKey(event) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); setBaseOpen(true); }
  }

  host.addEventListener('click', click);
  host.addEventListener('pointerover', link); host.addEventListener('pointerout', link);
  host.addEventListener('focusin', link); host.addEventListener('focusout', link);
  document.addEventListener('keydown', onKeyDown, true);
  slider.addEventListener('pointerdown', onSliderDown);
  slider.addEventListener('pointermove', onSliderMove);
  slider.addEventListener('pointerup', onSliderUp);
  slider.addEventListener('pointercancel', onSliderUp);
  slider.addEventListener('keydown', onSliderKey);
  baseList.addEventListener('keydown', onBaseKey);
  baseButton.addEventListener('keydown', onBaseButtonKey);
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
    host.removeEventListener('pointerover', link); host.removeEventListener('pointerout', link);
    host.removeEventListener('focusin', link); host.removeEventListener('focusout', link);
    document.removeEventListener('keydown', onKeyDown, true);
    delete host.foldPaperInspection;
  };
}
