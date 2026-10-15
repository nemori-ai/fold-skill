import { escapeHTML as esc, formatDate, formatTime, kindLabel, getItem, colorFor, currentAsk, feedbackTrail, personName, scenario, findEvent } from './shared.mjs?v=feedback-loop-1';
import { layoutPapers } from './a-layout.mjs';
import { normalizeAsk, responseHTML, composerHTML, deferHTML, scheduleHTML, keypadHTML, bindResponses } from '../respond.mjs?v=respond-1';
import { TAIL_ID, foldLayer, openAsks, dueText, createAnswerBook, answerWords, actionText, authorOf, eventRef, feedbackLine,
  markdownHTML, plainText, itemVersions, createFlipBoard, flipList } from './spatial-kit.mjs';

// A · 空间排布. Scene: at the desk, a few things in life need a choice right now.
// The most urgent two or three questions stand as cards on the left, answerable in place;
// the rest of the state lies on the desk as papers whose area is exactly their share.
const monthDayCN = value => new Intl.DateTimeFormat('zh-CN', { timeZone: scenario.timeZone || 'Asia/Shanghai', month: 'long', day: 'numeric' }).format(new Date(value));
const FRAME_MS = 320, LAYER_MS = 460;
// Two question cards on a laptop screen, three when the column has room for them.
const bigCount = () => (globalThis.innerHeight || 900) >= 980 ? 3 : 2;
const expectWord = { decide: '决定', input: '提供', act: '去做' };
const askWord = ask => ask.expects === 'choose' ? '待你选择' : ask.expects === 'approve' ? '待你批准' : ask.expects === 'confirm' ? '待你确认'
  : ask.expects === 'schedule' ? '待你定时间' : ask.expects === 'defer' ? '待你定何时再看' : `待你${ask.meanings.map(value => expectWord[value] || value).join('、')}`;
// What a paper too small for the full label still says.
const askShort = ask => ({ choose: '选择', approve: '批准', confirm: '确认', schedule: '定时间', defer: '定何时', reply: '回复' })[ask.expects] || '要你';
const changeWord = { added: '新增', updated: '更新', withdrawn: '撤下', restored: '重新纳入', merged: '合并' };
const stamp = value => `${formatDate(value)} ${formatTime(value)}`;
const windowText = window => window ? `${stamp(window.from)} – ${formatDate(window.from) === formatDate(window.to) ? formatTime(window.to) : stamp(window.to)}` : '';
const sameText = (a, b) => { const norm = value => String(value).replace(/[\s，。？?、：:]/g, ''); return norm(b).includes(norm(a)) || norm(a).includes(norm(b)); };

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
  for (const id of from) if (!to.has(id)) { const target = follow(id, after, to); if (target) links.push({ from: id, to: target }); }
  for (const id of to) if (!from.has(id)) { const source = follow(id, before, from); if (source) links.push({ from: source, to: id }); }
  return links;
}

export function mount(host, model) {
  let current = model.snapshot(), slow = false, disposed = false, resizeFrame = null, boardSize = '';
  let baseOpen = false, baseActive = 0, dragging = false;
  let tailOpen = false, readerEvent = null, panel = null, panelOrigin = 'side', lastAnswer = null, showFolded = false, showAllOwn = false;
  const expanded = new Set();                  // folded questions opened as cards
  const answers = createAnswerBook(scenario.frames);
  host.innerHTML = `<div class="a-workspace">
    <header class="a-header">
      <button class="a-wordmark" data-a-action="root" aria-label="回到全部事项">Fold<span>${esc(personName)} 的事项</span></button>
      <div class="a-header-tools"><button data-lab-inspect="inputs">原始输入</button><button data-lab-inspect="state" class="a-data-button" aria-label="查看完整状态 JSON">{ }</button></div>
    </header>
    <div class="a-scene-heading"><div class="a-now"><span class="a-day"></span><span class="a-clock"></span></div><h1 class="a-frame-title"></h1></div>
    <div class="a-round" aria-label="本轮调用"></div>
    <main class="a-main">
      <aside class="a-side" aria-label="等你回应的问题与你在原处做的事">
        <section class="a-asks" aria-labelledby="a-asks-title"></section>
        <section class="a-own" aria-label="这一轮你在原处做了什么"></section>
      </aside>
      <section class="a-desk" aria-label="当前层的注意力分配">
        <div class="a-scope"><nav class="a-breadcrumb" aria-label="当前层级"></nav><div class="a-budget"></div></div>
        <div class="a-board-wrap"><div class="a-board" id="a-board"></div><div class="a-empty" hidden><p>暂无事项</p><span>当前尚未纳入任何事项。</span><button data-a-action="first">查看首次输入 <span>→</span></button></div></div>
        <div class="a-below-board"><span class="a-legend"><i class="a-legend-paper"></i>面积 = 份额<i class="a-legend-ask"></i>等你回应<i class="a-legend-changed"></i>本轮有变化</span><button class="a-compare-toggle" data-a-action="compare" aria-pressed="false">对比变化 <span aria-hidden="true">↔</span></button></div>
        <div class="a-compare-bar" hidden>
          <span class="a-base-label" id="a-base-label">比较起点</span>
          <div class="a-base"><button class="a-base-button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="a-base-label a-base-value"><span id="a-base-value"></span><span class="a-caret" aria-hidden="true"></span></button><ul class="a-base-list" role="listbox" tabindex="-1" aria-labelledby="a-base-label" hidden></ul></div>
          <button data-lab-inspect="diff">核对具体变化 ↗</button><button class="a-compare-close" data-a-action="compare" aria-label="结束比较">×</button>
        </div>
      </section>
    </main>
    <div class="a-meaning"><p class="a-narrative"></p><button data-lab-inspect="batch" title="查看这一轮声明与回执">声明与回执 ↗</button></div>
    <footer class="a-time-controls">
      <div class="a-play-controls"><button class="a-play" data-a-action="play"></button><button class="a-step" data-a-action="previous" aria-label="上一帧">←</button><button class="a-step" data-a-action="next" aria-label="下一帧">→</button></div>
      <div class="a-timeline"><div class="a-slider" role="slider" tabindex="0" aria-label="选择回放帧" aria-valuemin="1"><div class="a-slider-track"><div class="a-slider-fill"></div><div class="a-slider-ticks"></div></div><div class="a-slider-thumb"></div></div><div class="a-timeline-labels"><span>${monthDayCN(scenario.frames[0].at)}</span><span class="a-frame-count"></span><span>${monthDayCN(scenario.frames.at(-1).at)}</span></div></div>
      <div class="a-motion-controls"><button data-a-action="replay" disabled>重播过渡</button><button data-a-action="slow" aria-pressed="false">慢速</button></div>
    </footer>
    <aside class="a-reader" aria-label="事项详情" tabindex="-1" hidden><div class="a-reader-top"><span></span><button data-a-action="close" aria-label="关闭详情（Esc）">×</button></div><div class="a-reader-body"></div></aside>
    <div class="a-toast" role="status" aria-live="polite" hidden></div>
    <div class="a-live" role="status" aria-live="polite" aria-atomic="true"></div>
  </div>`;
  const $ = selector => host.querySelector(selector);
  const board = $('.a-board'), reader = $('.a-reader'), slider = $('.a-slider');
  const baseButton = $('.a-base-button'), baseList = $('.a-base-list');
  const flip = createFlipBoard(board, { tileClass: 'a-paper', duration: FRAME_MS, onRender: fitPaper });
  const asksMotion = flipList($('.a-asks')), ownMotion = flipList($('.a-own'));
  $('.a-slider-ticks').innerHTML = scenario.frames.map((frame, index) => `<i style="left:${index / (scenario.frames.length - 1) * 100}%"${frame.signal?.type === 'review' ? ' class="is-review"' : ''}></i>`).join('');

  // ---------- questions ----------

  const answerFor = entry => {
    const record = answers.find(entry.item.id, current.cursor, entry.ask.id);
    if (!record || (record.meaning === 'snooze' && record.until <= current.cursor)) return null;
    return { record, ...answers.status(record, current.cursor) };
  };
  function askPlan(s) {
    const all = openAsks(s, { prefer: 'choose' }).map(entry => ({ ...entry, answer: answerFor(entry) }));
    const snoozed = all.filter(entry => entry.answer?.record.meaning === 'snooze');
    const live = all.filter(entry => entry.answer?.record.meaning !== 'snooze');
    // Up to three unanswered questions stand as cards; answered ones keep their place, compact.
    const big = [], folded = [];
    let open = 0;
    for (const entry of live) {
      if (entry.answer) big.push(entry);
      else if (open < bigCount()) { big.push(entry); open += 1; }
      else folded.push(entry);
    }
    return { all, big, folded, snoozed };
  }
  const receiptLine = answer => answer.status === 'acknowledged' ? `Agent 已在 ${formatTime(answer.at)} 的整理中收到` : '已保存，等 Agent 下一轮整理';
  function panelHTML(ask, itemId, where) {
    if (!panel || panel.where !== where || (panel.key !== itemId && !panel.key.startsWith(`${itemId}:`))) return '';
    const action = ask.actions.find(entry => `${itemId}:${entry.id}` === panel.key);
    const classes = { btn: 'a-btn', fill: 'is-fill', line: 'is-line', options: 'a-options', composer: 'a-composer', send: 'a-send', suggest: 'a-suggest' };
    const body = panel.kind === 'compose' && action ? composerHTML(action, { key: panel.key, classes }) : panel.kind === 'keypad' && action ? keypadHTML(action, { key: panel.key, classes })
      : panel.kind === 'schedule' && action ? scheduleHTML(action, { key: panel.key, now: current.cursor, classes }) : panel.kind === 'defer' ? deferHTML({ target: itemId, now: current.cursor, classes }) : '';
    return body ? `<div class="a-panel">${body}<button class="a-text" data-a-action="panel-close">收起</button></div>` : '';
  }
  function controlsHTML(entry) {
    const classes = { actions: 'a-actions', btn: 'a-btn', fill: 'is-fill', line: 'is-line', snooze: 'a-later' };
    const html = responseHTML(entry.ask, { target: entry.item.id, classes, showSubject: false });
    // Number keys pick the options of the card that has focus.
    let n = 0;
    return html.replace(/(<button type="button" class="rs-btn[^"]*" data-rs-act="[^"]+">)/g, match => `${match}<kbd aria-hidden="true">${++n}</kbd>`);
  }
  function cardHTML(entry, s, { big = true, where = 'side' } = {}) {
    const { item, ask, answer } = entry, now = Date.parse(s.now);
    const due = dueText(entry, now);
    const head = `<div class="a-ask-kicker"><span class="a-expect">${answer ? '你已回应' : askWord(ask)}</span>${due ? `<span class="a-ask-due${entry.overdue ? ' is-late' : ''}">${esc(due)}</span>` : ''}<span class="a-ask-share">${item.share} 份</span></div>`;
    const about = `<button class="a-ask-item" data-shared-select="${esc(item.id)}"><span>${esc(item.title)}</span><span aria-hidden="true">›</span></button>`;
    if (answer) {
      return `<article class="a-ask is-answered${answer.status === 'acknowledged' ? ' is-received' : ''}" data-flip-key="${esc(ask.id)}" data-a-paper="${esc(item.id)}">${head}<p class="a-ask-answer"><b>✓ ${esc(answerWords(answer.record))}</b><span>${receiptLine(answer)}</span></p><p class="a-ask-prompt is-quiet">${esc(ask.prompt)}</p><div class="a-ask-foot">${about}<button class="a-text" data-a-undo="${esc(answer.record.key)}">撤销</button></div></article>`;
    }
    return `<article class="a-ask${big ? ' is-big' : ''}" data-flip-key="${esc(ask.id)}" data-a-paper="${esc(item.id)}" data-a-card="${esc(item.id)}">${head}<p class="a-ask-prompt">${esc(ask.prompt)}</p>${about}<div class="a-ask-respond">${controlsHTML(entry)}${panelHTML(ask, item.id, where)}</div></article>`;
  }
  function renderAsks(s, animate) {
    const plan = askPlan(s), el = $('.a-asks');
    const unanswered = plan.all.filter(entry => !entry.answer).length;
    asksMotion(() => {
      if (!plan.all.length) {
        el.innerHTML = `<header class="a-side-head"><h2 id="a-asks-title">现在要你定</h2></header><p class="a-calm">此刻没有登记了回应路径的问题。纸面上都是进行中与知会的事。</p>`;
        return;
      }
      const folded = plan.folded.map(entry => expanded.has(entry.ask.id) ? cardHTML(entry, s)
        : `<button class="a-ask-row" data-flip-key="${esc(entry.ask.id)}" data-a-expand="${esc(entry.ask.id)}" data-a-paper="${esc(entry.item.id)}"><span class="a-expect">${askWord(entry.ask)}</span><span class="a-row-prompt">${esc(entry.ask.prompt)}</span><span class="a-row-meta">${esc(entry.item.title)} · ${entry.item.share} 份${entry.due !== null ? ` · <em class="${entry.overdue ? 'is-late' : ''}">${esc(dueText(entry, Date.parse(s.now)))}</em>` : ''}</span></button>`).join('');
      const snoozed = plan.snoozed.map(entry => `<div class="a-ask-row is-snoozed" data-flip-key="${esc(entry.ask.id)}" data-a-paper="${esc(entry.item.id)}"><span class="a-expect">◷ ${esc(answerWords(entry.answer.record))}</span><span class="a-row-prompt">${esc(entry.ask.prompt)}</span><button class="a-text" data-a-undo="${esc(entry.answer.record.key)}">撤销</button></div>`).join('');
      el.innerHTML = `<header class="a-side-head"><h2 id="a-asks-title">现在要你定</h2><span>${unanswered ? `${unanswered} 个等你` : '都已回应'}${plan.all.length - unanswered ? ` · ${plan.all.length - unanswered} 个已回应` : ''}</span></header>
        <div class="a-ask-list">${plan.big.map(entry => cardHTML(entry, s)).join('')}</div>
        ${plan.folded.length ? `<button class="a-ask-more" data-a-action="more-asks" aria-expanded="${showFolded}" data-flip-key="more">${showFolded ? '收起' : `另有 ${plan.folded.length} 个问题开着`}<span aria-hidden="true">${showFolded ? '▴' : '▾'}</span></button>` : ''}
        ${showFolded && plan.folded.length ? `<div class="a-ask-folded">${folded}</div>` : ''}
        ${snoozed ? `<div class="a-ask-snoozed"><h3>稍后再看</h3>${snoozed}</div>` : ''}`;
    }, { animate });
  }

  // ---------- the person's own moves this round ----------

  // Datasets that never mark the person's own inputs (the story) have nothing to show here.
  const tracksSelf = scenario.frames.some(frame => frame.events.some(event => event.self));
  function renderOwn(s, animate) {
    if (!tracksSelf) { $('.a-own').hidden = true; return; }
    const own = s.frame.events.filter(event => event.self);
    ownMotion(() => {
      if (!own.length) { $('.a-own').innerHTML = s.frame.events.length ? `<header class="a-side-head"><h2>这一轮你在原处</h2><span>没有动作</span></header>` : ''; return; }
      const shown = showAllOwn ? own : own.slice(0, 4);
      $('.a-own').innerHTML = `<header class="a-side-head"><h2>这一轮你在原处做了</h2><span>${own.length} 件</span></header><ol class="a-own-list">${shown.map(event => {
        const act = actionText(event);
        const links = (event.feedback || []).map(link => feedbackLine(event, link, s.index, s.state));
        const target = links[0]?.target || event.relatedIds?.find(id => getItem(s.state, id));
        const note = links.map(line => line.answers ? `回答了「${esc(line.prompt)}」${line.choice ? `：${esc(line.choice)}` : ''}` : `记在「${esc(line.title)}」${line.stillOpen ? '，问题仍开着' : ''}`).join('；');
        return `<li data-flip-key="${esc(event.id)}"><button class="a-own-row" data-a-event="${esc(event.id)}" ${target ? `data-a-paper="${esc(target)}"` : ''}><span class="a-own-what"><b>${esc(act.sentence)}</b><time>${formatTime(event.at)}</time></span>${act.title ? `<span class="a-own-object">${esc(act.title)}</span>` : ''}${note ? `<span class="a-own-link">↳ ${note}</span>` : ''}</button></li>`;
      }).join('')}</ol>${own.length > 4 ? `<button class="a-ask-more" data-a-action="more-own" aria-expanded="${showAllOwn}" data-flip-key="own-more">${showAllOwn ? '收起' : `还有 ${own.length - 4} 件`}<span aria-hidden="true">${showAllOwn ? '▴' : '▾'}</span></button>` : ''}`;
    }, { animate });
  }

  // ---------- papers ----------

  function tailState(s) {
    const fold = foldLayer(s.state.root, s);
    const added = new Set(s.frameDiff.changes.filter(change => change.type === 'added').map(change => change.item));
    fold.ordered = [...fold.tail].sort((a, b) => Number(added.has(b.id)) - Number(added.has(a.id)) || Date.parse(b.updated_at) - Date.parse(a.updated_at));
    fold.added = added;
    return fold;
  }
  function paperEntries(s, width, height) {
    let items, budget, fold = null;
    if (tailOpen && !s.layerId) {
      fold = tailState(s);
      if (!fold.tail.length) tailOpen = false;
      else { items = fold.ordered.map((item, index) => ({ ...item, rank: index + 1 })); budget = fold.tailShare; }
    }
    if (!items) {
      fold = !s.layerId ? tailState(s) : null;
      // Papers are packed in reading order; the folded block reads after every item that stands alone.
      items = fold && fold.tail.length ? fold.entries.map((entry, index) => ({ ...entry, rank: index + 1 })) : s.layer.items;
      budget = s.layer.budget;
    }
    const layout = layoutPapers(items, budget, width, height);
    const diff = new Map((s.comparing ? s.diff : s.frameDiff).changes.map(change => [change.item, change]));
    const responded = new Set(s.frame.events.flatMap(event => [...(event.feedback || []).map(link => link.target), event.reminder?.target]).filter(Boolean));
    const plan = askPlan(s), cards = new Set(plan.big.map(entry => entry.item.id));
    return { layout, budget, entries: layout.papers.map(rect => {
      if (rect.id === TAIL_ID) {
        const html = `<button class="a-paper-main a-tail" data-a-tail aria-label="另有 ${fold.tail.length} 件小事，合计 ${fold.tailShare} 份；铺开"><span class="a-paper-kicker"><span class="a-kind">另有 <b>${fold.tail.length}</b> 件小事 · 各 1 份</span><span class="a-share">${fold.tailShare}<span> 份</span></span></span><ul class="a-tail-list">${fold.ordered.map(item => `<li style="--paper-color:${colorFor(item, s.state)}" class="${fold.added.has(item.id) ? 'is-new' : ''}">${esc(item.title)}</li>`).join('')}</ul><span class="a-tail-more"></span><span class="a-tail-open">铺开 ↗</span></button>`;
        return { id: TAIL_ID, x: rect.x, y: rect.y, width: rect.width, height: rect.height, html, key: html, className: `is-tail ${fold.added.size ? 'is-changed' : ''}`, style: { '--paper-color': 'oklch(.86 .015 100)' } };
      }
      const item = getItem(s.state, rect.id);
      const ask = currentAsk(s, item.id), normalized = ask && normalizeAsk(ask);
      const found = ask && answers.find(item.id, current.cursor, ask.id);
      // A snooze is not an answer: the question stays open, it only waits for its time.
      const snooze = found?.meaning === 'snooze' && found.until > current.cursor ? found : null;
      const record = found && found.meaning !== 'snooze' ? found : null;
      const stub = rect.width < 64 || rect.height < 40, tiny = !stub && (rect.width < 132 || rect.height < 96);
      const compact = !stub && !tiny && (rect.width < 210 || rect.height < 170), roomy = rect.width > 300 && rect.height > 230;
      const size = stub ? 'is-stub' : tiny ? 'is-tiny' : compact ? 'is-compact' : roomy ? 'is-readable is-roomy' : 'is-readable';
      const base = item.share >= 24 ? 28 : item.share >= 12 ? 23 : item.share >= 6 ? 18 : item.share >= 3 ? 15 : 13;
      const titleSize = Math.min(base, tiny ? 13 : rect.width < 170 ? 15 : rect.width < 240 ? 19 : 28);
      const change = diff.get(item.id);
      const note = change ? change.before?.share != null && change.after?.share != null ? `${change.before.share}→${change.after.share} 份` : changeWord[change.type] || '更新' : '';
      const children = item.children?.items?.length || 0;
      const kicker = record ? `<span class="a-answered">✓ ${tiny || stub ? '已回应' : esc(answerWords(record).replace(/^你/, ''))}</span>` : snooze ? `<span class="a-snoozed">◷ ${tiny || stub ? formatTime(snooze.until) : `${formatTime(snooze.until)} 再看`}</span>` : ask ? `<span class="a-expect">${tiny || stub ? askShort(normalized) : askWord(normalized)}</span>` : `<span class="a-kind">${kindLabel[item.kind] || item.kind}</span>`;
      const label = [item.title, ask ? `${askWord(normalized)}：${ask.prompt}` : kindLabel[item.kind], `${item.share} 份`, note, responded.has(item.id) ? '本轮有回应' : ''].filter(Boolean).join('，');
      const html = `<button class="a-paper-main" data-shared-select="${esc(item.id)}" aria-label="${esc(label)}"><span class="a-paper-kicker">${kicker}<span class="a-share">${item.share}<span> 份</span></span></span><h2 style="--title-size:${titleSize}px">${esc(item.title)}</h2>${ask && !record && !cards.has(item.id) && !tiny && !sameText(ask.prompt, item.title) ? `<p class="a-paper-ask">${esc(ask.prompt)}</p>` : ''}${!tiny ? `<p class="a-paper-summary">${esc(item.summary)}</p>` : ''}${roomy && item.reason ? `<p class="a-paper-why"><span>为什么在这里</span>${esc(item.reason)}</p>` : ''}<span class="a-paper-foot">${note ? `<span class="a-change-note">${note}</span>` : ''}${responded.has(item.id) ? '<span class="a-foot-response" title="本轮有回应">↩</span>' : ''}</span></button>${children && !stub ? `<button class="a-paper-dive" data-shared-dive="${esc(item.id)}" aria-label="展开${esc(item.title)}的${children}个子项">${children} 个子项 <span aria-hidden="true">↗</span></button>` : ''}`;
      return { id: item.id, x: rect.x, y: rect.y, width: rect.width, height: rect.height, html, key: html,
        className: `${size} ${ask && !record ? 'has-ask' : ''} ${record ? 'is-answered' : ''} ${change ? 'is-changed' : ''} ${cards.has(item.id) ? 'has-card' : ''} ${s.selectedId === item.id ? 'is-selected' : ''}`,
        style: { '--paper-color': colorFor(item, s.state) } };
    }) };
  }
  // Fit text by measuring the rendered DOM: summary first, then the question, then the title.
  function fitPaper(paper, entry) {
    const main = paper.querySelector(':scope > .flip-body .a-paper-main');
    if (!main) return;
    if (entry.id === TAIL_ID) {
      const list = main.querySelector('.a-tail-list'), limit = list.clientHeight;
      let hidden = 0;
      for (const li of list.children) if (li.offsetTop - list.offsetTop + li.offsetHeight > limit + 1) { li.hidden = true; hidden += 1; }
      main.querySelector('.a-tail-more').textContent = hidden ? `还有 ${hidden} 件` : '';
      return;
    }
    const over = () => main.scrollHeight > main.clientHeight + 1;
    const clamp = (el, min) => { for (let n = 4; n >= min && over(); n -= 1) { el.style.webkitLineClamp = String(n); el.style.display = '-webkit-box'; el.style.webkitBoxOrient = 'vertical'; el.style.overflow = 'hidden'; } };
    const summary = main.querySelector('.a-paper-summary'), ask = main.querySelector('.a-paper-ask'), title = main.querySelector('h2'), why = main.querySelector('.a-paper-why');
    if (why) { clamp(why, 2); if (over()) why.remove(); }
    if (summary) { clamp(summary, 1); if (over()) summary.remove(); }
    if (ask && over()) { clamp(ask, 1); if (over()) ask.remove(); }
    if (title && over()) {
      let size = parseFloat(title.style.getPropertyValue('--title-size')) || 15;
      while (over() && size > 12) title.style.setProperty('--title-size', `${--size}px`);
      clamp(title, 1);
    }
    paper.dataset.clipped = over() || title?.scrollHeight > title?.clientHeight + 1 ? '1' : '';
  }
  function renderBoard(s, event, previous) {
    const width = board.clientWidth, height = board.clientHeight;
    if (!width || !height) return;
    boardSize = `${width}:${height}`;
    const { layout, entries, budget } = paperEntries(s, width, height);
    board.classList.toggle('is-full', layout.used === budget);
    hidePeek();
    $('.a-empty').hidden = entries.length !== 0;
    const kind = event?.kind;
    let zoom = null;
    if (kind && event.anchorRect) zoom = kind === 'dive' ? { from: event.anchorRect, to: { x: 0, y: 0, width, height } } : null;
    if (kind === 'rise' && event.anchorId) { const anchor = entries.find(entry => entry.id === event.anchorId); if (anchor) zoom = { from: { x: 0, y: 0, width, height }, to: anchor }; }
    const links = previous && kind === 'frame' ? mergeLinks(previous.state, s.state, previous.layer, s.layer) : [];
    flip.update(entries, { animate: Boolean(kind), links, zoom, scale: (kind === 'dive' || kind === 'rise' ? LAYER_MS / FRAME_MS : 1) * (slow ? 3 : 1) });
    $('[data-a-action="replay"]').disabled = !flip.canReplay;
  }

  // ---------- reader ----------

  function askBlock(item, s) {
    const ask = currentAsk(s, item.id);
    if (!ask) return item.kind === 'needs-you' ? '<p class="a-loop-none">这一版没有登记回应路径：Agent 改写了内容但未重新登记，回应无法从这里回传。</p>' : '';
    const entry = { item, ask: normalizeAsk(ask), due: ask.due_at ? Date.parse(ask.due_at) : null };
    entry.overdue = entry.due !== null && entry.due < Date.parse(s.now);
    entry.answer = answerFor(entry);
    return `<div class="a-reader-ask">${cardHTML(entry, s, { where: 'reader' }).replace('data-flip-key', 'data-reader-key')}</div>`;
  }
  function itemReader(s) {
    const item = s.selectedItem, index = s.index;
    const versions = itemVersions(item.id, index), max = Math.max(1, ...versions.map(version => version.share || 0));
    const trail = feedbackTrail(s, item.id);
    const sources = (item.sources || []).map(source => {
      const event = source.ref?.startsWith('event:') ? findEvent(source.ref.slice(6)) : null;
      const text = source.content || source.quote || event?.text || '';
      const who = event ? authorOf(event) : { name: source.author || '' };
      const head = `<span class="a-src-meta">${esc(source.channel || event?.channel || '')}${who.name ? ` · ${esc(who.name)}` : ''}${event?.at ? ` · ${esc(stamp(event.at))}` : ''}</span>${event?.self ? `<b>${esc(actionText(event).sentence)}</b>` : ''}`;
      return text ? `<details class="a-src"><summary>${head}<span class="a-src-preview">${esc(plainText(text))}</span><span class="a-src-toggle">原文</span></summary><div class="a-md">${markdownHTML(text)}</div></details>` : `<div class="a-src">${head}</div>`;
    }).join('');
    return `<div class="a-detail"><div class="a-detail-kicker">${kindLabel[item.kind] || item.kind} · ${item.share} / 64 份${item.status !== 'active' ? ` · ${item.status === 'merged' ? '已合并' : '已撤下'}` : ''}</div><h2>${esc(item.title)}</h2><p class="a-detail-summary">${esc(item.summary)}</p>
      ${askBlock(item, s)}
      ${item.reason ? `<section><h3>为什么在这里</h3><p>${esc(item.reason)}</p></section>` : ''}
      ${item.children?.items?.length ? `<section><h3>子事项 · ${item.children.items.length}</h3>${item.children.items.map(child => `<button class="a-row-link" data-shared-select="${esc(child.id)}">${esc(child.title)}<small>${child.share} 份</small></button>`).join('')}<button class="a-text" data-shared-dive="${esc(item.id)}">查看子事项概览 ↗</button></section>` : ''}
      ${sources ? `<section><h3>依据 · ${item.sources.length} 条</h3>${sources}</section>` : ''}
      ${trail.length ? `<section><h3>来源处的回应 · ${trail.length}</h3><ol class="a-trail">${trail.map(({ event, links, frameIndex }) => `<li${frameIndex === index ? ' class="is-now"' : ''}><time>${esc(stamp(event.at))}</time><b>${event.reminder ? '到点提醒' : event.self ? esc(actionText(event).sentence) : `${esc(authorOf(event).name)} 回复`}</b><span>${links.map(link => { const line = feedbackLine(event, link, frameIndex, s.state); return line.answers ? `回答了「${esc(line.prompt)}」${line.choice ? `：${esc(line.choice)}` : ''}` : '记在这件事上，没有回答它的问题'; }).join('；')}</span></li>`).join('')}</ol></section>` : ''}
      ${versions.length ? `<section><h3>这件事的版本 · ${versions.length}</h3><ol class="a-versions">${versions.map(version => `<li class="${version.index === index ? 'is-now' : ''}"><button data-a-frame="${version.index}" title="跳到这一帧"><span class="a-v-when"><time>${esc(stamp(version.at))}</time><em>${changeWord[version.type] || version.type}${version.fields?.includes('share') && version.before?.share != null ? ` · ${version.before.share}→${version.share}` : ''}</em></span><span class="a-v-bar" style="--w:${Math.round((version.share || 0) / max * 100)}%"><i></i><b>${version.share || 0}</b></span><span class="a-v-title">${esc(version.title || '')}</span></button></li>`).reverse().join('')}</ol></section>` : ''}
      <details class="a-json"><summary>此事项的原始 JSON</summary><pre>${esc(JSON.stringify(item, null, 2))}</pre></details></div>`;
  }
  function eventReader(s, event) {
    const who = authorOf(event), ref = eventRef(event), act = event.self ? actionText(event) : null;
    const index = s.frames.findIndex(frame => frame.events.includes(event));
    const links = (event.feedback || []).map(link => feedbackLine(event, link, index, s.state));
    return `<div class="a-detail"><div class="a-detail-kicker">${esc(event.channel)} · ${esc(stamp(event.at))}${who.tag ? ` · ${who.tag}` : ''}</div><h2>${esc(act ? act.sentence : who.name)}</h2>${ref.title ? `<p class="a-detail-object">${ref.label ? `<b>${esc(ref.label)}</b> ` : ''}${esc(ref.title)}</p>` : ''}<div class="a-md a-quote">${markdownHTML(event.text)}</div>
      ${links.length ? `<section><h3>接到了哪件事</h3>${links.map(line => `<button class="a-row-link" data-shared-select="${esc(line.target)}">${line.answers ? `回答了「${esc(line.prompt)}」${line.choice ? `：${esc(line.choice)}` : ''}` : `记在「${esc(line.title)}」上${line.stillOpen ? '，那里的问题仍开着' : ''}`}</button>`).join('')}</section>` : ''}
      ${event.why ? `<section><h3>Agent 怎样处理这条输入</h3><p>${esc(event.why)}</p></section>` : ''}</div>`;
  }
  function renderReader(s) {
    const event = readerEvent ? findEvent(readerEvent) : null;
    if (!s.selectedItem && !event) { reader.hidden = true; return; }
    const keep = !reader.hidden && reader.dataset.for === (event ? `e:${readerEvent}` : s.selectedId) ? reader.scrollTop : 0;
    reader.hidden = false;
    reader.dataset.for = event ? `e:${readerEvent}` : s.selectedId;
    $('.a-reader-top span').textContent = event ? '原始输入' : s.selectedItem.status === 'active' ? '事项详情' : '历史事项';
    $('.a-reader-body').innerHTML = event ? eventReader(s, event) : itemReader(s);
    reader.scrollTop = keep;
  }

  // ---------- frame ----------

  function renderRound(s) {
    const signal = s.frame.signal, round = $('.a-round');
    const own = s.frame.events.filter(event => event.self).length;
    if (!signal) { round.innerHTML = '<span>尚无输入：Fold 还没有被调用。</span>'; return; }
    if (signal.type === 'review') { round.innerHTML = `<span class="a-round-kind">零事件整理</span><span>${esc(signal.reason)} · 窗口 ${esc(windowText(signal.window))}</span><span>覆盖：${esc(signal.coverage || '未说明')}</span>`; return; }
    round.innerHTML = `<span><b>${signal.received}</b> 条输入 · 窗口 ${esc(windowText(signal.window))}${signal.reason ? ` · ${esc(signal.reason)}` : ''}</span>${signal.coverage ? `<span class="a-round-cover">${esc(signal.coverage)}</span>` : ''}${own ? `<span>你在原处做了 <b>${own}</b> 件</span>` : ''}`;
  }
  function baseLabel(s, index) { const frame = s.frames[index]; return `${formatDate(frame.at)} ${formatTime(frame.at)} · ${frame.title}`; }
  function renderBaseList() {
    const s = current;
    baseList.innerHTML = s.frames.slice(0, s.index + 1).map((frame, index) => `<li role="option" id="a-base-${index}" data-index="${index}" aria-selected="${index === s.baseIndex}" class="${index === baseActive ? 'is-active' : ''}"><time>${esc(formatDate(frame.at))} ${esc(formatTime(frame.at))}</time><span>${esc(frame.title)}</span></li>`).join('');
    baseList.setAttribute('aria-activedescendant', `a-base-${baseActive}`);
    baseList.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }
  function setBaseOpen(open, focusButton = false) {
    baseOpen = open; baseButton.setAttribute('aria-expanded', String(open)); baseList.hidden = !open;
    if (open) { baseActive = current.baseIndex; renderBaseList(); baseList.focus({ preventScroll: true }); }
    else if (focusButton) baseButton.focus({ preventScroll: true });
  }
  function moveBase(index) {
    baseActive = Math.max(0, Math.min(current.index, index));
    baseList.querySelectorAll('[role="option"]').forEach(option => option.classList.toggle('is-active', Number(option.dataset.index) === baseActive));
    baseList.setAttribute('aria-activedescendant', `a-base-${baseActive}`);
    baseList.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }
  function chooseBase(index) { setBaseOpen(false, true); if (index !== current.baseIndex) model.setBase(index); }
  function renderSlider(s) {
    const last = s.frames.length - 1;
    slider.setAttribute('aria-valuemax', String(s.frames.length));
    slider.setAttribute('aria-valuenow', String(s.index + 1));
    slider.setAttribute('aria-valuetext', `第 ${s.index + 1} 帧，共 ${s.frames.length} 帧：${stamp(s.frame.at)}，${s.frame.title}`);
    slider.style.setProperty('--progress', `${s.index / last * 100}%`);
  }
  let toastTimer = null;
  function toast(text, undo = null) {
    const el = $('.a-toast');
    el.innerHTML = `<span>${esc(text)}</span>${undo ? `<button data-a-undo="${esc(undo.key)}">撤销 <kbd>U</kbd></button>` : ''}`;
    el.hidden = false; el.classList.remove('is-leaving');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.add('is-leaving'); toastTimer = setTimeout(() => { el.hidden = true; }, 180); }, undo ? 4200 : 2600);
  }
  function render(s, event) {
    const stateChanged = ['frame', 'dive', 'rise', 'compare'].includes(event.type);
    const previous = event.previous;
    if (event.type === 'frame' && previous && previous.index !== s.index) {
      panel = null; readerEvent = readerEvent && Date.parse(findEvent(readerEvent)?.at) <= s.cursor ? readerEvent : null;
      const received = answers.list(previous.cursor).filter(record => answers.status(record, previous.cursor).status === 'saved' && answers.status(record, s.cursor).status === 'acknowledged');
      if (received.length) setTimeout(() => toast(`Agent 已在 ${formatTime(s.frame.at)} 的整理中收到你的 ${received.length} 条回应`), 0);
    }
    if (event.type === 'select') readerEvent = null;
    if (event.type === 'dive' || event.type === 'rise') tailOpen = false;
    current = s;
    $('.a-day').textContent = formatDate(s.now);
    $('.a-clock').textContent = formatTime(s.now);
    $('.a-frame-title').textContent = s.layerId ? getItem(s.state, s.layerId).title : s.frame.title;
    const fold = !s.layerId ? tailState(s) : null;
    $('.a-breadcrumb').innerHTML = `<button data-a-action="root" ${s.layerId || tailOpen ? '' : 'aria-current="page"'}>全部事项</button>${s.path.map(item => `<span aria-hidden="true">/</span><button data-shared-dive="${esc(item.id)}" ${item.id === s.layerId ? 'aria-current="page"' : ''}>${esc(item.title)}</button>`).join('')}${tailOpen && fold?.tail.length ? `<span aria-hidden="true">/</span><button aria-current="page" data-a-action="tail">另有 ${fold.tail.length} 件小事</button><span class="a-scope-note">放大显示，合计 ${fold.tailShare} 份</span>` : ''}${s.layerId ? '<span class="a-scope-note">子层独立 64 份</span>' : ''}`;
    const plan = askPlan(s), waiting = plan.all.filter(entry => !entry.answer).length;
    $('.a-budget').innerHTML = tailOpen && fold?.tail.length ? `<span>${fold.tail.length} 件小事，每件 1 份，放大显示</span><b>${fold.tailShare}<small> / ${s.layer.budget} 份</small></b>`
      : `<span>${s.layer.items.length} 件${waiting ? `，<em>${waiting} 件等你</em>` : ''}</span><b>${s.layer.used}<small> / ${s.layer.budget} 份</small></b>`;
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
    const focusKey = focusMemo();
    if (event.type !== 'play') {
      renderAsks(s, stateChanged || ['answer', 'panel', 'tail'].includes(event.type));
      renderOwn(s, event.type === 'frame');
      renderBoard(s, stateChanged || event.type === 'tail' || event.type === 'answer' ? { kind: event.type === 'compare' || event.type === 'answer' ? 'frame' : event.kind || event.type, anchorId: event.anchorId, anchorRect: event.anchorRect } : null, previous);
    }
    const wasFor = reader.hidden ? null : reader.dataset.for;
    renderReader(s);
    // Opening a reader moves the keyboard into it; Esc brings it back to the paper or card.
    if (event.type === 'select' && !reader.hidden && reader.dataset.for !== wasFor) reader.focus({ preventScroll: true });
    else restoreFocus(focusKey);
    if (event.type === 'frame' || event.type === 'dive' || event.type === 'rise') $('.a-live').textContent = `${$('.a-frame-title').textContent}，当前${s.layer.items.length}件事，占${s.layer.used}份${waiting ? `，${waiting}个问题等你` : ''}。`;
  }
  // Re-rendered lists keep keyboard focus on the same control.
  function focusMemo() {
    const el = document.activeElement;
    if (!el || !host.contains(el) || el === document.body) return null;
    const region = el.closest('.a-reader') ? '.a-reader' : el.closest('.a-side') ? '.a-side' : el.closest('.a-board') ? '.a-board .a-paper:not(.is-leaving) > .flip-body' : null;
    if (!region) return null;
    const attr = name => `[data-${name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${CSS.escape(el.dataset[name])}"]`;
    if (el.dataset.rsOpen) return `${region} ${attr('rsOpen')}${attr('rsKey')}`;
    for (const name of ['rsAct', 'rsDefer', 'aExpand', 'aUndo', 'sharedSelect', 'sharedDive', 'aEvent', 'aAction', 'aFrame', 'aTail']) if (el.dataset[name] !== undefined) return `${region} ${attr(name)}`;
    return null;
  }
  function restoreFocus(selector) {
    if (!selector || host.contains(document.activeElement) && document.activeElement !== document.body) return;
    host.querySelector(selector)?.focus({ preventScroll: true });
  }
  const rerender = type => render(current, { type, previous: current });

  // ---------- answering ----------

  function answer(itemId, action, extra = {}) {
    const item = getItem(current.state, itemId), ask = item && currentAsk(current, itemId);
    if (!ask) return;
    model.pause();
    panel = null;
    lastAnswer = answers.save(item, ask, action, current.cursor, extra);
    rerender('answer');
    toast(`${answerWords(lastAnswer)} · ${lastAnswer.meaning === 'snooze' ? '先移到下方，到点再回来' : '已保存，等 Agent 下一轮整理'}`, lastAnswer);
    // The keyboard stays where the answer was given: on the receipt's undo, or on the next question after a snooze.
    const where = panelOrigin === 'reader' ? '.a-reader' : '.a-side';
    const next = lastAnswer.meaning === 'snooze' ? host.querySelector(`${where} .a-ask[data-a-card] [data-rs-act]`) : host.querySelector(`${where} .a-ask[data-a-paper="${CSS.escape(itemId)}"] [data-a-undo]`);
    next?.focus({ preventScroll: true });
  }
  function undo(key) {
    const record = answers.store.list().find(entry => entry.key === key);
    if (!record) return;
    answers.undo(record);
    if (lastAnswer?.key === key) lastAnswer = null;
    rerender('answer');
    toast('已撤销，这个问题重新等你回应');
    host.querySelector(`.a-ask[data-a-paper="${CSS.escape(record.item)}"] [data-rs-act]`)?.focus({ preventScroll: true });
  }
  const unbindResponses = bindResponses(host, {
    ask: target => currentAsk(current, target),
    respond: (target, action, extra) => answer(target, action, extra),
    open: (kind, key) => {
      const same = panel && panel.kind === kind && panel.key === key && panel.where === panelOrigin;
      panel = kind === 'actions' || same ? null : { kind, key, where: panelOrigin };
      rerender('panel');
      if (panel) host.querySelector('.a-panel textarea, .a-panel button')?.focus({ preventScroll: true });
    },
    undo: () => {},
  });

  // ---------- events ----------

  function closeReader() {
    const selected = current.selectedId;
    readerEvent = null;
    if (selected) model.select(null); else renderReader(current);
    const target = selected && (board.querySelector(`.a-paper[data-id="${CSS.escape(selected)}"]:not(.is-leaving) > .flip-body .a-paper-main`) || host.querySelector(`.a-ask[data-a-paper="${CSS.escape(selected)}"] button`));
    (target || $('[data-a-action="root"]')).focus({ preventScroll: true });
  }
  function setTail(open) {
    if (tailOpen === open) return;
    const anchorRect = open ? flip.rect(TAIL_ID) : null;
    tailOpen = open;
    model.pause();
    render(current, { type: 'tail', kind: open ? 'dive' : 'rise', anchorId: TAIL_ID, anchorRect, previous: current });
    (open ? board.querySelector('.a-paper:not(.is-leaving) > .flip-body .a-paper-main') : board.querySelector(`.a-paper[data-id="${TAIL_ID}"]:not(.is-leaving) > .flip-body .a-paper-main`))?.focus({ preventScroll: true });
  }
  function onKeyDown(event) {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (!document.getElementById('lab-inspector')?.hidden || !document.getElementById('lab-about')?.hidden) return;
    const typing = event.target.matches?.('input,textarea,select');
    if (event.key === 'Escape') {
      if (baseOpen) return;
      if (panel) {
        const where = panel.where, key = panel.key;
        panel = null; rerender('panel'); event.preventDefault(); event.stopImmediatePropagation();
        host.querySelector(`${where === 'reader' ? '.a-reader' : '.a-side'} [data-rs-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
        return;
      }
      if (typing) return;
      if (!reader.hidden) { event.preventDefault(); event.stopImmediatePropagation(); closeReader(); return; }
      if (tailOpen) { event.preventDefault(); event.stopImmediatePropagation(); setTail(false); return; }
      return;
    }
    if (typing) return;
    const key = event.key.toLowerCase();
    if (key === 'u' && lastAnswer) { event.preventDefault(); undo(lastAnswer.key); return; }
    const card = event.target.closest?.('.a-ask[data-a-card]');
    if (card && /^[1-9]$/.test(event.key)) {
      const option = card.querySelectorAll('[data-rs-act]')[Number(event.key) - 1];
      if (option) { event.preventDefault(); option.click(); }
    }
  }
  function click(event) {
    if (baseOpen && !event.target.closest('.a-base')) setBaseOpen(false);
    const option = event.target.closest('.a-base-list [role="option"]');
    if (option) { chooseBase(Number(option.dataset.index)); return; }
    if (event.target.closest('.a-base-button')) { setBaseOpen(!baseOpen, baseOpen); return; }
    const el = event.target.closest('[data-a-action],[data-a-undo],[data-a-expand],[data-a-event],[data-a-tail],[data-a-frame]');
    if (!el || !host.contains(el)) return;
    const d = el.dataset;
    if (d.aUndo) { undo(d.aUndo); return; }
    if (d.aExpand) { expanded.has(d.aExpand) ? expanded.delete(d.aExpand) : expanded.add(d.aExpand); rerender('panel'); host.querySelector(`[data-flip-key="${CSS.escape(d.aExpand)}"] [data-rs-act], [data-a-expand="${CSS.escape(d.aExpand)}"]`)?.focus({ preventScroll: true }); return; }
    if (d.aEvent) { model.pause(); readerEvent = d.aEvent; renderReader(current); $('.a-reader-top button').focus({ preventScroll: true }); return; }
    if (d.aTail !== undefined) { setTail(true); return; }
    if (d.aFrame) { model.goFrame(Number(d.aFrame)); return; }
    const action = d.aAction;
    if (action === 'root') { if (tailOpen) setTail(false); else model.goRoot(); }
    else if (action === 'tail') setTail(true);
    else if (action === 'first') model.goFrame(1);
    else if (action === 'previous') model.goFrame(current.index - 1);
    else if (action === 'next') model.goFrame(current.index + 1);
    else if (action === 'play') model.togglePlay();
    else if (action === 'compare') model.setCompare(!current.comparing);
    else if (action === 'more-asks') { showFolded = !showFolded; rerender('panel'); $('[data-a-action="more-asks"]')?.focus({ preventScroll: true }); }
    else if (action === 'more-own') { showAllOwn = !showAllOwn; renderOwn(current, true); $('[data-a-action="more-own"]')?.focus({ preventScroll: true }); }
    else if (action === 'panel-close') { panel = null; rerender('panel'); }
    else if (action === 'slow') { slow = !slow; el.setAttribute('aria-pressed', String(slow)); el.textContent = slow ? '慢速中' : '慢速'; }
    else if (action === 'replay') { model.pause(); flip.replay(slow ? 3 : 1); }
    else if (action === 'close') closeReader();
  }
  // A paper too small for its text shows it whole beside itself.
  const peek = document.createElement('div');
  peek.className = 'a-peek'; peek.setAttribute('aria-hidden', 'true');
  $('.a-board-wrap').append(peek);
  let peekTimer = null, peekFor = null;
  function hidePeek() { clearTimeout(peekTimer); peekFor = null; peek.classList.remove('is-shown'); }
  function showPeek(paper) {
    const id = paper.dataset.id, item = getItem(current.state, id);
    if (!item || !paper.isConnected) return;
    const ask = currentAsk(current, id), record = ask && answers.find(id, current.cursor, ask.id);
    peek.innerHTML = `<div class="a-peek-kicker"><span${ask && !record ? ' class="a-expect"' : ''}>${record ? `${record.meaning === 'snooze' ? '◷' : '✓'} ${esc(answerWords(record).replace(/^你/, ''))}` : ask ? askWord(normalizeAsk(ask)) : kindLabel[item.kind] || item.kind}</span><span>${item.share} 份</span></div><strong>${esc(item.title)}</strong>${ask && !record ? `<p class="a-peek-ask">${esc(ask.prompt)}</p>` : ''}<p>${esc(item.summary)}</p><small>点开看详情与依据 ›</small>`;
    const wrap = $('.a-board-wrap').getBoundingClientRect(), r = paper.getBoundingClientRect();
    const width = 280, gap = 8;
    let x = r.right - wrap.left + gap;
    if (x + width > wrap.width) x = r.left - wrap.left - width - gap;
    if (x < 0) x = Math.max(0, Math.min(wrap.width - width, r.left - wrap.left));
    peek.style.left = `${x}px`;
    peek.style.top = '0px';
    const height = peek.offsetHeight;
    peek.style.top = `${Math.max(0, Math.min(wrap.height - height, r.top - wrap.top))}px`;
    peek.classList.add('is-shown');
  }
  function peekOver(event) {
    const paper = event.target.closest?.('.a-paper:not(.is-leaving):not(.is-tail)');
    if (!paper || paper.dataset.id === peekFor) return;
    hidePeek();
    const cramped = paper.matches('.is-tiny, .is-stub') || paper.dataset.clipped === '1';
    if (!cramped || board.classList.contains('is-moving')) return;
    peekFor = paper.dataset.id;
    peekTimer = setTimeout(() => showPeek(paper), event.type === 'focusin' ? 0 : 220);
  }
  function peekOut(event) {
    const from = event.target.closest?.('.a-paper');
    if (from && event.relatedTarget && from.contains(event.relatedTarget)) return;
    hidePeek();
  }
  // Hovering or focusing a card, a row or an action points at its paper.
  function link(event) {
    const source = event.target.closest?.('[data-a-paper]');
    host.querySelectorAll('.a-paper.is-linked, .a-ask.is-linked, .a-ask-row.is-linked').forEach(el => el.classList.remove('is-linked'));
    const entering = event.type === 'pointerover' || event.type === 'focusin';
    // A paper points back at its question card, when it has one.
    const paper = entering && !source && event.target.closest?.('.a-paper:not(.is-leaving)');
    if (paper) host.querySelectorAll(`.a-side [data-a-paper="${CSS.escape(paper.dataset.id)}"]`).forEach(el => el.matches('.a-ask, .a-ask-row') && el.classList.add('is-linked'));
    if (!source || !entering) return;
    const id = source.dataset.aPaper;
    (board.querySelector(`.a-paper[data-id="${CSS.escape(id)}"]:not(.is-leaving)`) || (tailState(current).tail.some(item => item.id === id) ? board.querySelector(`.a-paper[data-id="${TAIL_ID}"]`) : null))?.classList.add('is-linked');
  }

  // Custom frame slider: pointer drag plus the standard slider keys.
  const frameAt = clientX => { const box = slider.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * (current.frames.length - 1)); };
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
    const next = { ArrowLeft: current.index - 1, ArrowDown: current.index - 1, ArrowRight: current.index + 1, ArrowUp: current.index + 1, PageDown: current.index - 5, PageUp: current.index + 5, Home: 0, End: last }[event.key];
    if (next === undefined || event.altKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault(); event.stopPropagation(); goTo(Math.max(0, Math.min(last, next)));
  }
  function onBaseKey(event) {
    const keys = { ArrowDown: baseActive + 1, ArrowUp: baseActive - 1, Home: 0, End: current.index, PageDown: baseActive + 8, PageUp: baseActive - 8 };
    if (event.key in keys) { event.preventDefault(); event.stopPropagation(); moveBase(keys[event.key]); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); chooseBase(baseActive); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setBaseOpen(false, true); }
    else if (event.key === 'Tab') setBaseOpen(false);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') event.stopPropagation();
  }
  function onBaseButtonKey(event) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); setBaseOpen(true); } }
  // Rendering dives through the anchor paper: remember where it stood before the layer changes.
  function subscriber(s, event) {
    if ((event.type === 'dive' || event.type === 'rise') && event.anchorId) event = { ...event, kind: event.type, anchorRect: event.type === 'dive' ? flip.rect(event.anchorId) : null };
    if (event.type === 'init') { current = s; render(s, { type: 'init' }); return; }
    render(s, event.type === 'frame' ? { ...event, kind: 'frame' } : event);
  }

  const notePanelOrigin = event => { panelOrigin = event.target.closest?.('.a-reader') ? 'reader' : 'side'; };
  host.addEventListener('click', notePanelOrigin, true);
  host.addEventListener('keydown', notePanelOrigin, true);
  board.addEventListener('pointerover', peekOver); board.addEventListener('pointerout', peekOut);
  board.addEventListener('focusin', peekOver); board.addEventListener('focusout', peekOut);
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
    resizeFrame = requestAnimationFrame(() => { if (!disposed) renderBoard(current, null, null); });
  });
  observer.observe(board);
  const unsubscribe = model.subscribe(subscriber);
  // Read-only inspection makes the encoded area and the answers checkable in the lab.
  host.foldPaperInspection = () => ({ layerId: current.layerId, tailOpen, used: current.layer.used, budget: current.layer.budget,
    ...paperEntries(current, board.clientWidth, board.clientHeight).layout, motion: flip.inspect(), answers: answers.list() });
  return () => {
    disposed = true; unsubscribe(); observer.disconnect(); cancelAnimationFrame(resizeFrame); unbindResponses();
    flip.clear(); host.removeEventListener('click', click); host.removeEventListener('click', notePanelOrigin, true); host.removeEventListener('keydown', notePanelOrigin, true);
    clearTimeout(peekTimer); clearTimeout(toastTimer);
    host.removeEventListener('pointerover', link); host.removeEventListener('pointerout', link);
    host.removeEventListener('focusin', link); host.removeEventListener('focusout', link);
    document.removeEventListener('keydown', onKeyDown, true);
    delete host.foldPaperInspection;
  };
}
