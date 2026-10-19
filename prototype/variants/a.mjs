import { escapeHTML as esc, formatDate, formatTime, kindLabel, getItem, colorFor, currentAsk, feedbackTrail, personName, scenario, findEvent, records } from './shared.mjs?v=feedback-loop-1';
import { layoutPapers } from './a-layout.mjs';
import { normalizeAsk, responseHTML, composerHTML, deferHTML, scheduleHTML, keypadHTML, bindResponses } from '../respond.mjs?v=respond-1';
import { TAIL_ID, foldLayer, openAsks, dueText, createAnswerBook, answerWords, actionText, authorOf, eventRef, feedbackLine,
  markdownHTML, plainText, itemVersions, createFlipBoard } from './spatial-kit.mjs';
import { createIx, detailHTML as ixDetailHTML } from '../forms/motion/ix.mjs';
import { itemFacts } from '../forms/motion/dial-model.mjs';
import { currentDataset } from '../data/select.mjs';
import { BEATS, STAGGER, STAGGER_MAX, EASE_IN_OUT, createBeat, play, beatList, fly, traces, flipHTML } from './a-motion.mjs';

// A · 空间排布. Scene: at the desk, a few things in life need a choice right now.
// The most urgent two or three questions stand as cards on the left, answerable in place;
// the rest of the state lies on the desk as papers whose area is exactly their share, the bare desk is what is unallocated.
//
// 动画（forms/polish/a-motion.md）：只在两种节拍上动——一轮整理落地（换轮），你作答、撤回或稍后。换轮按节拍表
// （a-motion.mjs BEATS）分组：切点换字 → 回执填实 → 英雄数字（桌面空着几份）→ 离场 → 主角（你答的、失效的）→ 移位 →
// 进场 → 新问题描一次朱红；作答时卡原地收成回执，桌面要等下一轮整理读到了才让出份额并重排，回执跟着条目走：
// 问题关上时它从左栏飞到自己的纸片上。纸片的位置跨帧稳定（a-layout.mjs 的 previous），同一帧无论从哪来都长一样。
// 概念层只有上一轮的轮廓，换轮的 1.1 秒内退干净。悬停与展开走共用的 ../forms/motion/ix.mjs：纸片沿自己的框外扩
// 8 px，引线出到详情卡，详情卡里能直接作答。直接打开（顶层、不带 ?frame=、没有 referrer）时讲一遍三拍。
const monthDayCN = value => new Intl.DateTimeFormat('zh-CN', { timeZone: scenario.timeZone || 'Asia/Shanghai', month: 'long', day: 'numeric' }).format(new Date(value));
const FRAME_MS = 320, LAYER_MS = 460, PLAY = 5.6;
const LAST = scenario.frames.length - 1;
const ALL = Object.freeze({ inputs: true, share: true, asks: true });
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
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
const nearRect = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
const shrink = (r, k = 0.4) => ({ x: r.x + r.width * (1 - k) / 2, y: r.y + r.height * (1 - k) / 2, width: r.width * k, height: r.height * k });
const shortName = id => scenario.categories?.[id]?.short || id;

// 自动讲一遍的样张：换轮到 at，替你按下真实数据里的那个回答，再换到下一轮整理（a-motion.md 3.6）。
const TELL = {
  composite: { from: 'f21', at: 'f22', item: 'smilla-vet', action: 'call', to: 'f23' },
  story: { from: 'f13', at: 'f14', item: 'family', action: 'change', to: 'f15' },
};
let told = false; // once per page load: switching to B and back does not tell it again

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

/** The root layer as the desk lays it out: one-share items without a question folded into one block, in rank order. */
const rootEntries = s => { const fold = foldLayer(s.state.root, s); return fold.tail.length ? fold.entries.map((entry, index) => ({ ...entry, rank: index + 1 })) : s.state.root.items; };

export function mount(host, model) {
  let current = model.snapshot(), slow = false, disposed = false, resizeFrame = null, boardSize = '';
  let baseOpen = false, baseActive = 0, dragging = false;
  let tailOpen = false, readerEvent = null, panel = null, panelOrigin = 'side', lastAnswer = null, showFolded = false, showAllOwn = false;
  const expanded = new Set();                  // folded questions opened as cards
  const answers = createAnswerBook(scenario.frames);
  const glowed = new Set();                    // frame:ask pairs whose “new question” outline has played
  let beat = null, held = false, heldAnims = [], pin = null;
  let playing = false, playT = 0, advancing = false, instantNext = false;
  let lastTurnFrom = null, guard = null, lastDown = null, tell = null, demoKey = null;
  let onBoard = new Set();                     // root papers on the desk: what hovering and opening work on
  let shown = new Map();                       // id → rect (board px) as last laid out
  const chain = { key: '', list: [] };         // the root layout of every frame up to the last one asked for
  host.innerHTML = `<div class="a-workspace">
    <header class="a-header">
      <button class="a-wordmark" data-a-action="root" aria-label="回到全部事项">Fold<span>${esc(personName)} 的事项</span></button>
      <div class="a-header-tools"><button data-lab-inspect="inputs">原始输入</button><button data-lab-inspect="state" class="a-data-button" aria-label="查看完整状态 JSON">{ }</button></div>
    </header>
    <div class="a-scene-heading"><div class="a-now"><span class="a-day"></span><span class="a-clock"></span></div><h1 class="a-frame-title"></h1><p class="a-tell" aria-live="polite" hidden></p></div>
    <div class="a-round" aria-label="本轮调用"></div>
    <main class="a-main">
      <aside class="a-side" aria-label="等你回应的问题与你在原处做的事">
        <section class="a-asks" aria-labelledby="a-asks-title"></section>
        <section class="a-own" aria-label="这一轮你在原处做了什么"></section>
      </aside>
      <section class="a-desk" aria-label="当前层的注意力分配">
        <div class="a-scope"><nav class="a-breadcrumb" aria-label="当前层级"></nav><div class="a-budget"></div></div>
        <div class="a-board-wrap"><div class="a-traces" aria-hidden="true"></div><div class="a-board" id="a-board"></div><div class="a-empty" hidden><p>暂无事项</p><span>当前尚未纳入任何事项。</span><button data-a-action="first">查看首次输入 <span>→</span></button></div></div>
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
      <div class="a-motion-controls"><button data-a-action="tell" hidden>▶ 讲一遍</button><button data-a-action="replay" disabled title="再演一遍刚才这一轮整理">重播这一轮</button><button data-a-action="slow" aria-pressed="false">慢速</button></div>
    </footer>
    <aside class="a-reader" aria-label="事项详情" tabindex="-1" hidden><div class="a-reader-top"><span></span><button data-a-action="close" aria-label="关闭详情（Esc）">×</button></div><div class="a-reader-body"></div></aside>
    <div class="a-fly" aria-hidden="true"></div><i class="a-clockwork" aria-hidden="true"></i>
    <div class="a-live" role="status" aria-live="polite" aria-atomic="true"></div>
  </div>`;
  const $ = selector => host.querySelector(selector);
  const workspace = $('.a-workspace'), board = $('.a-board'), wrap = $('.a-board-wrap'), reader = $('.a-reader'), slider = $('.a-slider');
  const traceLayer = $('.a-traces'), flyLayer = $('.a-fly'), clockEl = $('.a-clockwork');
  const baseButton = $('.a-base-button'), baseList = $('.a-base-list');
  // The shared interaction module's styles (summary and detail cards), themed by a.css. Relative to index.html.
  if (!document.querySelector('link[data-ix-css]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.dataset.ixCss = ''; link.href = './forms/motion/ix.css'; document.head.prepend(link); }
  const flip = createFlipBoard(board, { tileClass: 'a-paper', duration: FRAME_MS, onRender: fitPaper });
  $('.a-slider-ticks').innerHTML = scenario.frames.map((frame, index) => `<i style="left:${index / (scenario.frames.length - 1) * 100}%"${frame.signal?.type === 'review' ? ' class="is-review"' : ''}></i>`).join('');

  // ---------- page-local answers ----------

  const answerFor = (entry, s = current) => {
    const record = answers.find(entry.item.id, s.cursor, entry.ask.id);
    if (!record || (record.meaning === 'snooze' && record.until <= s.cursor)) return null;
    return { record, ...answers.status(record, s.cursor) };
  };
  const answersOf = (id, s = current) => answers.list(s.cursor).filter(record => record.item === id && record.meaning !== 'snooze').sort((a, b) => b.at - a.at);
  /** An answer to an earlier question on this item, which the Agent has since replaced with another one. */
  const priorFor = (entry, s = current) => { const record = answersOf(entry.item.id, s).find(r => r.ask && r.ask !== entry.ask.id); return record ? { record, ...answers.status(record, s.cursor) } : null; };
  /** The receipt a paper carries once its question has closed: it follows the item, not the version. */
  const carriedFor = (item, s = current) => { if (currentAsk(s, item.id)) return null; const record = answersOf(item.id, s)[0]; return record ? { record, ...answers.status(record, s.cursor) } : null; };
  const isNewAsk = (s, ask) => { if (!ask?.registered_at || s.index === 0) return false; const t = Date.parse(ask.registered_at); return t > Date.parse(s.frames[s.index - 1].at) && t <= Date.parse(s.frame.at); };
  const glowFor = (s, ask, mode) => {
    if (!ask || !isNewAsk(s, ask) || !['turn', 'init'].includes(mode)) return false;
    return !glowed.has(`${s.index}:${ask.id}`);
  };

  // ---------- questions ----------

  function askPlan(s) {
    const all = openAsks(s, { prefer: 'choose' }).map(entry => ({ ...entry, answer: answerFor(entry, s) }));
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
  const receiptLine = answer => answer.status === 'acknowledged' ? `已收到 · Agent 在 ${formatTime(answer.at)} 的整理中读到` : '已保存 · 等 Agent 下一轮整理，桌面还没变';
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
  // The item line under a question: on the desk it unfolds that paper in place; elsewhere it opens the reader.
  const aboutHTML = (item, where = 'side') => `<button class="a-ask-item" ${where === 'side' && onBoard.has(item.id) ? `data-a-open="${esc(item.id)}"` : `data-shared-select="${esc(item.id)}"`}><span>${esc(item.title)}</span><span aria-hidden="true">›</span></button>`;
  function cardHTML(entry, s, { big = true, where = 'side', mode = 'local' } = {}) {
    const { item, ask, answer } = entry, now = Date.parse(s.now);
    const due = dueText(entry, now);
    const keyed = where === 'side' ? `data-flip-key="${esc(item.id)}"` : `data-card-key="${esc(item.id)}"`;
    const head = `<div class="a-ask-kicker"><span class="a-expect">${answer ? '你已回应' : askWord(ask)}</span>${due ? `<span class="a-ask-due${entry.overdue ? ' is-late' : ''}">${esc(due)}</span>` : ''}<span class="a-ask-share">${item.share} 份</span></div>`;
    if (answer) {
      return `<article class="a-ask is-answered${answer.status === 'acknowledged' ? ' is-received' : ''}" ${keyed} data-face="receipt:${esc(ask.id)}" data-status="${answer.status}" data-a-paper="${esc(item.id)}">${head}<p class="a-ask-answer"><b><i class="a-tick" aria-hidden="true">✓</i> ${esc(answerWords(answer.record))}</b><span>${receiptLine(answer)}</span></p><p class="a-ask-prompt is-quiet">${esc(ask.prompt)}</p><div class="a-ask-foot">${aboutHTML(item, where)}<button class="a-text" data-a-undo="${esc(answer.record.key)}">撤销</button></div></article>`;
    }
    const prior = priorFor(entry, s);
    const glow = where === 'side' && glowFor(s, ask, mode);
    return `<article class="a-ask${big ? ' is-big' : ''}${glow ? ' is-new-ask' : ''}" ${keyed} data-face="card:${esc(ask.id)}" data-a-paper="${esc(item.id)}" data-a-card="${esc(item.id)}">${head}<p class="a-ask-prompt">${esc(ask.prompt)}</p>${prior ? `<p class="a-ask-prior">你 ${formatTime(prior.record.at)} 答过上一版：${esc(answerWords(prior.record).replace(/^你/, ''))} · ${prior.status === 'acknowledged' ? 'Agent 已收到，问题随后改写' : '已保存'}</p>` : ''}${aboutHTML(item, where)}<div class="a-ask-respond">${controlsHTML(entry)}${panelHTML(ask, item.id, where)}</div></article>`;
  }
  function asksHTML(s, mode) {
    const plan = askPlan(s);
    const unanswered = plan.all.filter(entry => !entry.answer).length;
    if (!plan.all.length) return { html: `<header class="a-side-head" data-flip-key="head" data-step="hero" data-face="0"><h2 id="a-asks-title">现在要你定</h2></header><p class="a-calm" data-flip-key="calm" data-face="calm">此刻没有登记了回应路径的问题。纸面上都是进行中与知会的事。</p>`, plan };
    const folded = plan.folded.map(entry => expanded.has(entry.ask.id) ? cardHTML(entry, s, { mode })
      : `<button class="a-ask-row" data-flip-key="${esc(entry.item.id)}" data-face="row:${esc(entry.ask.id)}" data-a-expand="${esc(entry.ask.id)}" data-a-paper="${esc(entry.item.id)}"><span class="a-expect">${askWord(entry.ask)}</span><span class="a-row-prompt">${esc(entry.ask.prompt)}</span><span class="a-row-meta">${esc(entry.item.title)} · ${entry.item.share} 份${entry.due !== null ? ` · <em class="${entry.overdue ? 'is-late' : ''}">${esc(dueText(entry, Date.parse(s.now)))}</em>` : ''}</span></button>`).join('');
    const snoozed = plan.snoozed.map(entry => `<div class="a-ask-row is-snoozed" data-flip-key="${esc(entry.item.id)}" data-face="snoozed:${esc(entry.ask.id)}" data-a-paper="${esc(entry.item.id)}"><span class="a-expect">◷ ${esc(answerWords(entry.answer.record))}</span><span class="a-row-prompt">${esc(entry.ask.prompt)}</span><button class="a-text" data-a-undo="${esc(entry.answer.record.key)}">撤销</button></div>`).join('');
    const answered = plan.all.length - unanswered;
    const html = `<header class="a-side-head" data-flip-key="head" data-step="hero" data-face="${unanswered}:${answered}"><h2 id="a-asks-title">现在要你定</h2><span>${unanswered ? `${unanswered} 个等你` : '都已回应'}${answered ? ` · ${answered} 个已回应` : ''}</span></header>
      <div class="a-ask-list">${plan.big.map(entry => cardHTML(entry, s, { mode })).join('')}</div>
      ${plan.folded.length ? `<button class="a-ask-more" data-a-action="more-asks" aria-expanded="${showFolded}" data-flip-key="more" data-step="flip" data-face="${plan.folded.length}:${showFolded}">${showFolded ? '收起' : `另有 ${plan.folded.length} 个问题开着`}<span aria-hidden="true">${showFolded ? '▴' : '▾'}</span></button>` : ''}
      ${showFolded && plan.folded.length ? `<div class="a-ask-folded">${folded}</div>` : ''}
      ${snoozed ? `<div class="a-ask-snoozed"><h3>稍后再看</h3>${snoozed}</div>` : ''}`;
    return { html, plan };
  }
  function renderAsks(s, ctx, { mode = 'local', self = null, lead = new Set(), carry = null } = {}) {
    const el = $('.a-asks');
    // A card promoted out of the fold slides out of where the fold row stood.
    const box = el.getBoundingClientRect(), more = el.querySelector('[data-flip-key="more"]')?.getBoundingClientRect();
    const fromFold = more && ctx && ctx.name !== 'turn' ? { y: more.top - box.top, h: more.height } : null;
    let plan = null;
    const carried = beatList(el, () => { const out = asksHTML(s, mode); el.innerHTML = out.html; plan = out.plan; }, { ctx, self, lead, carry, origin: () => fromFold });
    for (const entry of plan?.all || []) if (glowFor(s, entry.ask, mode)) glowed.add(`${s.index}:${entry.ask.id}`);
    return carried;
  }

  // ---------- the person's own moves this round ----------

  // Datasets that never mark the person's own inputs (the story) have nothing to show here.
  const tracksSelf = scenario.frames.some(frame => frame.events.some(event => event.self));
  function renderOwn(s, ctx) {
    if (!tracksSelf) { $('.a-own').hidden = true; return; }
    const own = s.frame.events.filter(event => event.self);
    beatList($('.a-own'), () => {
      if (!own.length) { $('.a-own').innerHTML = s.frame.events.length ? `<header class="a-side-head"><h2>这一轮你在原处</h2><span>没有动作</span></header>` : ''; return; }
      const list = showAllOwn ? own : own.slice(0, 4);
      $('.a-own').innerHTML = `<header class="a-side-head"><h2>这一轮你在原处做了</h2><span>${own.length} 件</span></header><ol class="a-own-list">${list.map(event => {
        const act = actionText(event);
        const links = (event.feedback || []).map(link => feedbackLine(event, link, s.index, s.state));
        const target = links[0]?.target || event.relatedIds?.find(id => getItem(s.state, id));
        const note = links.map(line => line.answers ? `回答了「${esc(line.prompt)}」${line.choice ? `：${esc(line.choice)}` : ''}` : `记在「${esc(line.title)}」${line.stillOpen ? '，问题仍开着' : ''}`).join('；');
        return `<li data-flip-key="${esc(event.id)}" data-face="own"><button class="a-own-row" data-a-event="${esc(event.id)}" ${target ? `data-a-paper="${esc(target)}"` : ''}><span class="a-own-what"><b>${esc(act.sentence)}</b><time>${formatTime(event.at)}</time></span>${act.title ? `<span class="a-own-object">${esc(act.title)}</span>` : ''}${note ? `<span class="a-own-link">↳ ${note}</span>` : ''}</button></li>`;
      }).join('')}</ol>${own.length > 4 ? `<button class="a-ask-more" data-a-action="more-own" aria-expanded="${showAllOwn}" data-flip-key="own-more" data-face="${showAllOwn}">${showAllOwn ? '收起' : `还有 ${own.length - 4} 件`}<span aria-hidden="true">${showAllOwn ? '▴' : '▾'}</span></button>` : ''}`;
    }, { ctx });
  }

  // ---------- papers ----------

  function tailState(s) {
    const fold = foldLayer(s.state.root, s);
    const added = new Set(s.frameDiff.changes.filter(change => change.type === 'added').map(change => change.item));
    fold.ordered = [...fold.tail].sort((a, b) => Number(added.has(b.id)) - Number(added.has(a.id)) || Date.parse(b.updated_at) - Date.parse(a.updated_at));
    fold.added = added;
    return fold;
  }
  /** The root layout of frame `index`, laid out after every earlier frame so that papers stay near where they stood. */
  function chainLayout(index, width, height) {
    const key = `${Math.round(width)}x${Math.round(height)}`;
    if (chain.key !== key) { chain.key = key; chain.list = []; }
    for (let j = chain.list.length; j <= index; j += 1) {
      const s = { index: j, state: records[j].state };
      const items = rootEntries(s).filter(item => item.status === undefined || item.status === 'active');
      const previous = chain.list[j - 1];
      chain.list[j] = items.length ? layoutPapers(items, s.state.root.budget, width, height, { previous: previous?.papers.length ? previous : null }) : null;
    }
    return chain.list[index];
  }
  function paperEntries(s, width, height, mode = 'local') {
    let items, budget, fold = null, layout = null;
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
      if (!s.layerId) layout = chainLayout(s.index, width, height);
    }
    // The chain is laid out from the replay's own states; the page draws the same ids, ranks and shares.
    if (!layout || layout.papers.length !== items.filter(item => item.status === undefined || item.status === 'active').length) layout = layoutPapers(items, budget, width, height);
    const diff = new Map((s.comparing ? s.diff : s.frameDiff).changes.map(change => [change.item, change]));
    const responded = new Set(s.frame.events.flatMap(event => [...(event.feedback || []).map(link => link.target), event.reminder?.target]).filter(Boolean));
    const plan = askPlan(s), cards = new Set(plan.big.map(entry => entry.item.id));
    const root = !s.layerId;
    return { layout, budget, fold, entries: layout.papers.map(rect => {
      if (rect.id === TAIL_ID) {
        const html = `<button class="a-paper-main a-tail" data-a-tail aria-label="另有 ${fold.tail.length} 件小事，合计 ${fold.tailShare} 份；铺开"><span class="a-paper-kicker"><span class="a-kind">另有 <b>${fold.tail.length}</b> 件小事 · 各 1 份</span><span class="a-share">${fold.tailShare}<span> 份</span></span></span><ul class="a-tail-list">${fold.ordered.map(item => `<li style="--paper-color:${colorFor(item, s.state)}" class="${fold.added.has(item.id) ? 'is-new' : ''}">${esc(item.title)}</li>`).join('')}</ul><span class="a-tail-more"></span><span class="a-tail-open">铺开 ↗</span></button>`;
        return { id: TAIL_ID, x: rect.x, y: rect.y, width: rect.width, height: rect.height, html, key: html, className: `is-tail ${fold.added.size ? 'is-changed' : ''}`, style: { '--paper-color': 'oklch(.86 .015 100)' } };
      }
      const item = getItem(s.state, rect.id);
      const ask = currentAsk(s, item.id), normalized = ask && normalizeAsk(ask);
      const found = ask && answers.find(item.id, s.cursor, ask.id);
      // A snooze is not an answer: the question stays open, it only waits for its time.
      const snooze = found?.meaning === 'snooze' && found.until > s.cursor ? found : null;
      const record = found && found.meaning !== 'snooze' ? found : null;
      const status = record ? answers.status(record, s.cursor).status : null;
      const carried = !ask ? carriedFor(item, s) : null;
      const stub = rect.width < 64 || rect.height < 40, tiny = !stub && (rect.width < 132 || rect.height < 96);
      const compact = !stub && !tiny && (rect.width < 210 || rect.height < 170), roomy = rect.width > 300 && rect.height > 230;
      const size = stub ? 'is-stub' : tiny ? 'is-tiny' : compact ? 'is-compact' : roomy ? 'is-readable is-roomy' : 'is-readable';
      const base = item.share >= 24 ? 28 : item.share >= 12 ? 23 : item.share >= 6 ? 18 : item.share >= 3 ? 15 : 13;
      const titleSize = Math.min(base, tiny ? 13 : rect.width < 170 ? 15 : rect.width < 240 ? 19 : 28);
      const change = diff.get(item.id);
      const note = change ? change.before?.share != null && change.after?.share != null ? `${change.before.share}→${change.after.share} 份` : changeWord[change.type] || '更新' : '';
      const children = item.children?.items?.length || 0;
      const said = r => esc(answerWords(r).replace(/^你/, ''));
      const kicker = record ? `<span class="a-answered">✓ ${tiny || stub ? '已回应' : `${said(record)} · ${status === 'acknowledged' ? '已收到' : '等整理'}`}</span>` : snooze ? `<span class="a-snoozed">◷ ${tiny || stub ? formatTime(snooze.until) : `${formatTime(snooze.until)} 再看`}</span>` : ask ? `<span class="a-expect">${tiny || stub ? askShort(normalized) : askWord(normalized)}</span>` : `<span class="a-kind">${kindLabel[item.kind] || item.kind}</span>`;
      // Its question closed: your receipt stays on the paper, worded as the question was then.
      const receipt = carried && !stub ? `<p class="a-paper-receipt"><b>✓ ${tiny ? '已回应' : said(carried.record)}</b>${tiny ? '' : ` · ${carried.status === 'acknowledged' ? '已收到' : '等整理'}`}</p>` : '';
      const label = [item.title, ask ? `${askWord(normalized)}：${ask.prompt}` : kindLabel[item.kind], `${item.share} 份`, note, carried ? answerWords(carried.record) : '', responded.has(item.id) ? '本轮有回应' : ''].filter(Boolean).join('，');
      const inner = `<span class="a-paper-kicker">${kicker}<span class="a-share">${item.share}<span> 份</span></span></span><h2 style="--title-size:${titleSize}px">${esc(item.title)}</h2>${receipt}${ask && !record && !cards.has(item.id) && !tiny && !sameText(ask.prompt, item.title) ? `<p class="a-paper-ask">${esc(ask.prompt)}</p>` : ''}${!tiny ? `<p class="a-paper-summary">${esc(item.summary)}</p>` : ''}${roomy && item.reason ? `<p class="a-paper-why"><span>为什么在这里</span>${esc(item.reason)}</p>` : ''}<span class="a-paper-foot">${note ? `<span class="a-change-note">${note}</span>` : ''}${responded.has(item.id) ? '<span class="a-foot-response" title="本轮有回应">↩</span>' : ''}</span>`;
      // Root papers are hovered and opened through ix (keyboard: its hidden buttons); papers of a sub-layer open the reader.
      const main = root ? `<div class="a-paper-main" role="img" aria-label="${esc(label)}">${inner}</div>` : `<button class="a-paper-main" data-shared-select="${esc(item.id)}" aria-label="${esc(label)}">${inner}</button>`;
      const html = `${main}${children && !stub ? `<button class="a-paper-dive" data-shared-dive="${esc(item.id)}" aria-label="展开${esc(item.title)}的${children}个子项">${children} 个子项 <span aria-hidden="true">↗</span></button>` : ''}`;
      const glow = ask && glowFor(s, ask, mode);
      return { id: item.id, x: rect.x, y: rect.y, width: rect.width, height: rect.height, html, key: html, share: item.share,
        className: `${size} ${ask && !record ? 'has-ask' : ''} ${record || carried ? 'is-answered' : ''} ${change ? 'is-changed' : ''} ${cards.has(item.id) ? 'has-card' : ''} ${s.selectedId === item.id ? 'is-selected' : ''} ${glow ? 'is-new-ask' : ''} ${root ? 'is-root' : ''}`,
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
  /**
   * The desk. `ctx` is the beat (turn, answer, undo, snooze) whose clock every paper moves on; without one the board
   * keeps its own 320 ms motion (zooming into the small things, a sub-layer, comparing) or none.
   */
  function renderBoard(s, ctx, { kind = null, anchorId = null, anchorRect = null, previous = null, lead = new Map(), prepared = null } = {}) {
    const width = board.clientWidth, height = board.clientHeight;
    if (!width || !height) return null;
    boardSize = `${width}:${height}`;
    const { layout, entries, budget, fold } = prepared || paperEntries(s, width, height, ctx?.name || 'local');
    board.classList.toggle('is-full', layout.used === budget);
    $('.a-empty').hidden = entries.length !== 0;
    let zoom = null;
    if (kind && anchorRect) zoom = kind === 'dive' ? { from: anchorRect, to: { x: 0, y: 0, width, height } } : null;
    if (kind === 'rise' && anchorId) { const anchor = entries.find(entry => entry.id === anchorId); if (anchor) zoom = { from: { x: 0, y: 0, width, height }, to: anchor }; }
    const links = previous && kind === 'frame' ? mergeLinks(previous.state, s.state, previous.layer, s.layer) : [];
    const beatTiming = ctx && !zoom ? timingFor(ctx, entries, fold, lead) : null;
    const scale = (kind === 'dive' || kind === 'rise' ? LAYER_MS / FRAME_MS : 1) * (slow ? 3 : 1);
    const plan = flip.update(entries, { animate: Boolean(kind) || Boolean(ctx), links, zoom, scale, timing: beatTiming, timer: !beatTiming });
    shown = new Map(entries.map(entry => [entry.id, { x: entry.x, y: entry.y, width: entry.width, height: entry.height, share: entry.share }]));
    prevTail = fold && !tailOpen && !s.layerId ? new Set(fold.tail.map(item => item.id)) : new Set();
    $('[data-a-action="replay"]').disabled = !lastTurnFrom;
    focusWas = null; popWas = '';
    return plan;
  }
  // Which small things sat in the folded block last render (a paper that steps out of it starts from the block).
  let prevTail = new Set();
  function timingFor(ctx, entries, fold, lead) {
    const B = ctx.B, tailNow = entries.find(entry => entry.id === TAIL_ID), tailWas = shown.get(TAIL_ID);
    const intoTail = new Set(fold && !tailOpen ? fold.tail.map(item => item.id) : []);
    let k = 0;
    return (kind, id, info) => {
      if (ctx.name !== 'turn') {
        // Answering, undoing or snoozing changes words on one paper; the desk itself waits for the next 整理.
        if (kind === 'move') return ctx.at(info.changed && nearRect(info.from, info.to) ? B.paper : B.move);
        return ctx.at(kind === 'enter' ? B.enter : B.exit);
      }
      if (kind === 'exit') return { ...ctx.at(info.merged ? B.merge : B.exit), ...(intoTail.has(id) && tailNow ? { to: shrink(tailNow, 0.3) } : {}) };
      if (kind === 'enter') {
        const stagger = ctx.t(Math.min(k++, STAGGER_MAX - 1) * STAGGER);
        return { ...ctx.at(B.enter, stagger), ...(prevTail.has(id) && tailWas ? { from: shrink(tailWas, 0.4) } : {}) };
      }
      const step = lead.get(id);
      if (step != null) return { ...ctx.at([B.lead[0] + step * B.leadStep, B.lead[1]]), easing: EASE_IN_OUT };
      return ctx.at(info.changed && nearRect(info.from, info.to) ? B.swap : B.move);
    };
  }

  // ---------- reader (the full text: sources, versions, raw JSON) ----------

  function askBlock(item, s) {
    const ask = currentAsk(s, item.id);
    if (!ask) return item.kind === 'needs-you' ? '<p class="a-loop-none">这一版没有登记回应路径：Agent 改写了内容但未重新登记，回应无法从这里回传。</p>' : '';
    const entry = { item, ask: normalizeAsk(ask), due: ask.due_at ? Date.parse(ask.due_at) : null };
    entry.overdue = entry.due !== null && entry.due < Date.parse(s.now);
    entry.answer = answerFor(entry, s);
    return `<div class="a-reader-ask">${cardHTML(entry, s, { where: 'reader' })}</div>`;
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

  // ---------- the detail card (ix): this one item, answerable in place ----------

  function detailAsksHTML(id) {
    const s = current, item = getItem(s.state, id);
    if (!item) return '<p class="ix-none">这一件不在这一轮</p>';
    const list = [];
    const walk = node => { const ask = currentAsk(s, node.id); if (ask) list.push(node); for (const child of node.children?.items || []) walk(child); };
    walk(item);
    const cards = list.slice(0, 2).map(node => {
      const ask = normalizeAsk(currentAsk(s, node.id)), due = ask.due_at ? Date.parse(ask.due_at) : null;
      const entry = { item: node, ask, due, overdue: due !== null && due < Date.parse(s.now) };
      entry.answer = answerFor(entry, s);
      return cardHTML(entry, s, { where: 'detail' });
    }).join('');
    const carried = carriedFor(item, s);
    return `<h5>这件事的问题<b>${list.length ? `${list.length} 个` : ''}</b></h5>${cards || (carried ? `<p class="a-d-receipt">✓ ${esc(answerWords(carried.record))} · ${carried.status === 'acknowledged' ? `Agent 在 ${formatTime(carried.at)} 的整理中收到` : '已保存，等 Agent 下一轮整理'}</p>` : '<p class="ix-none">没有开着的问题</p>')}`;
  }
  function detailCardHTML(f, o) {
    const html = ixDetailHTML(f, { ...o, asks: [] });
    const asks = `<section class="a-d-asks" data-a-detail-ask="${esc(f.id)}">${detailAsksHTML(f.id)}</section>`;
    return `${html.replace(/<section><h5>开着的问题[\s\S]*?<\/section>/, asks)}<p class="a-d-more"><button type="button" class="a-text" data-shared-select="${esc(f.id)}">依据、版本与原文 ↗</button></p>`;
  }
  function refreshDetail() {
    const section = wrap.querySelector('.ix-detail [data-a-detail-ask]');
    if (section && ix.s.open === section.dataset.aDetailAsk) section.innerHTML = detailAsksHTML(section.dataset.aDetailAsk);
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
    slider.setAttribute('aria-valuemax', String(s.frames.length));
    slider.setAttribute('aria-valuenow', String(s.index + 1));
    slider.setAttribute('aria-valuetext', `第 ${s.index + 1} 帧，共 ${s.frames.length} 帧：${stamp(s.frame.at)}，${s.frame.title}`);
    slider.style.setProperty('--progress', `${s.index / LAST * 100}%`);
  }
  function renderHeading(s) {
    $('.a-day').textContent = formatDate(s.now);
    $('.a-clock').textContent = formatTime(s.now);
    $('.a-frame-title').textContent = s.layerId ? getItem(s.state, s.layerId).title : s.frame.title;
  }
  function renderBreadcrumb(s) {
    const fold = !s.layerId ? tailState(s) : null;
    $('.a-breadcrumb').innerHTML = `<button data-a-action="root" ${s.layerId || tailOpen ? '' : 'aria-current="page"'}>全部事项</button>${s.path.map(item => `<span aria-hidden="true">/</span><button data-shared-dive="${esc(item.id)}" ${item.id === s.layerId ? 'aria-current="page"' : ''}>${esc(item.title)}</button>`).join('')}${tailOpen && fold?.tail.length ? `<span aria-hidden="true">/</span><button aria-current="page" data-a-action="tail">另有 ${fold.tail.length} 件小事</button><span class="a-scope-note">放大显示，合计 ${fold.tailShare} 份</span>` : ''}${s.layerId ? '<span class="a-scope-note">子层独立 64 份</span>' : ''}`;
  }
  /** The desk's hero: how many of the 64 shares lie unallocated, as bare desk. Only on the root layer. */
  function renderBudget(s, ctx, waiting) {
    const el = $('.a-budget'), fold = !s.layerId ? tailState(s) : null;
    const was = { n: el.querySelector('.a-hero-n')?.innerHTML, sub: el.querySelector('.a-budget-sub')?.innerHTML, blank: Number(el.dataset.blank) };
    if (tailOpen && fold?.tail.length) { el.innerHTML = `<span>${fold.tail.length} 件小事，每件 1 份，放大显示</span><b>${fold.tailShare}<small> / ${s.layer.budget} 份</small></b>`; delete el.dataset.blank; return; }
    if (s.layerId) { el.innerHTML = `<span>${s.layer.items.length} 件${waiting ? `，<em>${waiting} 件等你</em>` : ''}</span><b>${s.layer.used}<small> / ${s.layer.budget} 份</small></b>`; delete el.dataset.blank; return; }
    const blank = s.layer.budget - s.layer.used;
    el.dataset.blank = String(blank);
    el.innerHTML = `<span class="a-budget-sub">${s.layer.items.length} 件 · 已占 ${s.layer.used} / ${s.layer.budget}</span><span class="a-hero" title="未分配的份额：空着的桌面"><b class="a-hero-n">${blank}</b><small>份空着</small></span>`;
    if (ctx?.name === 'turn' && was.n != null) {
      flipHTML(ctx, el.querySelector('.a-hero-n'), was.n, ctx.B.hero, { roll: Math.abs(blank - was.blank) === 1 });
      flipHTML(ctx, el.querySelector('.a-budget-sub'), was.sub, ctx.B.hero);
    }
  }
  function say(text) { $('.a-live').textContent = text; }
  function renderKeys() {
    $('.a-play').textContent = playing ? 'Ⅱ 暂停' : '▶ 播放';
    $('[data-a-action="tell"]').hidden = !(topLevel && tellPlan);
    $('[data-a-action="tell"]').textContent = tell ? '■ 跳过' : told ? '↺ 重演' : '▶ 讲一遍';
  }

  // ---------- the beat: one per turn or press; holds, pins and finishes all its animations together ----------

  function newBeat(name) {
    const ctx = createBeat(name, slow ? 3 : 1);
    ctx.clock = play(ctx, clockEl, [{ opacity: 0 }, { opacity: 0 }], [0, ctx.B.end], { easing: 'linear', fill: 'none' });
    return ctx;
  }
  /** Seconds into the beat on screen (its own clock: it stops while held and stands still while pinned). */
  function beatTime() {
    if (!beat?.clock) return null;
    if (beat.clock.playState === 'finished' || !beat.anims.has(beat.clock)) return beat.B.end;
    return Number(beat.clock.currentTime || 0) / 1000 / beat.scale;
  }
  function finishBeat() {
    if (!beat) return;
    const list = [...beat.anims];
    beat = null; heldAnims = [];
    for (const a of list) { try { a.finish(); } catch { a.cancel(); } }
  }
  /** Adopt every animation this render started (the board's, the CSS outline) into the beat. */
  function adopt(ctx) {
    for (const a of workspace.getAnimations({ subtree: true })) if (!(globalThis.CSSTransition && a instanceof CSSTransition)) ctx.add(a);
    if (held || pin != null) for (const a of ctx.anims) { a.pause(); if (pin != null) a.currentTime = pin * ctx.scale * 1000; }
    if (held) heldAnims = [...ctx.anims];
  }
  function setHeld(on) {
    if (on && ix.s.via === 'tour') return;
    if (held === on) return;
    held = on;
    if (on) { heldAnims = beat ? [...beat.anims].filter(a => a.playState === 'running') : []; heldAnims.forEach(a => a.pause()); }
    else { if (pin == null) heldAnims.forEach(a => { if (a.playState === 'paused') a.play(); }); heldAnims = []; }
  }
  function pinAt(t) {
    pin = t == null ? null : Number(t);
    if (!beat) return;
    for (const a of beat.anims) {
      if (pin == null) { if (!held && a.playState === 'paused') a.play(); }
      else { a.pause(); a.currentTime = pin * beat.scale * 1000; }
    }
  }

  // ---------- render ----------

  function render(s, event) {
    const previous = event.previous;
    const turning = event.type === 'frame' && previous && previous.index !== s.index;
    if (turning) {
      ix.reset();
      panel = null; readerEvent = readerEvent && Date.parse(findEvent(readerEvent)?.at) <= s.cursor ? readerEvent : null;
      lastTurnFrom = previous;
      // Any navigation but play's own step (and the tell's) stops play.
      if (!advancing && playing) setPlaying(false);
    }
    if (event.type === 'select') { readerEvent = null; if (s.selectedId) ix.reset(); }
    if (event.type === 'dive' || event.type === 'rise') { tailOpen = false; ix.reset(); }
    if (event.type === 'tail' || event.type === 'compare') ix.reset();
    finishBeat();
    const motion = !reduced() && event.type !== 'init' && !event.instant;
    const name = turning ? 'turn' : event.beat || (['panel', 'compare', 'tail'].includes(event.type) ? 'local' : null);
    const ctx = motion && name ? newBeat(name) : null;
    const mode = turning ? (motion ? 'turn' : 'init') : event.type === 'init' ? 'init' : name || 'local';
    current = s;
    renderHeading(s);
    renderBreadcrumb(s);
    renderRound(s);
    const review = s.frame.signal?.type === 'review';
    $('.a-narrative').innerHTML = `${review ? '<b>这次整理的结果</b>' : ''}${esc(s.frame.narrative)}`;
    $('[data-a-action="previous"]').disabled = s.index === 0;
    $('[data-a-action="next"]').disabled = s.index === LAST;
    renderSlider(s);
    $('.a-frame-count').textContent = `${s.index + 1} / ${s.frames.length}`;
    $('.a-compare-toggle').setAttribute('aria-pressed', String(s.comparing));
    $('.a-compare-bar').hidden = !s.comparing;
    $('#a-base-value').textContent = baseLabel(s, s.baseIndex);
    if (baseOpen) { if (!s.comparing) setBaseOpen(false); else renderBaseList(); }
    renderKeys();
    const focusKey = focusMemo();
    const plan = askPlan(s), waiting = plan.all.filter(entry => !entry.answer).length;
    if (event.type !== 'play') {
      // The desk is laid out first, so a receipt leaving the column knows where its paper lands.
      const width = board.clientWidth, height = board.clientHeight;
      const prepared = width && height ? paperEntries(s, width, height, mode) : null;
      onBoard = new Set(!s.layerId && prepared ? prepared.entries.filter(entry => entry.id !== TAIL_ID).map(entry => entry.id) : []);
      const lead = turning && previous ? leadsOf(previous, s) : new Map();
      const boardBox = board.getBoundingClientRect();
      const landing = id => { const entry = prepared?.entries.find(x => x.id === id); return entry ? { x: boardBox.left + entry.x, y: boardBox.top + entry.y, w: entry.width, h: entry.height } : null; };
      const carry = turning && ctx ? (key, old) => old.face.startsWith('receipt:') && Boolean(landing(key)) : null;
      const carried = renderAsks(s, ctx, { mode, self: event.target || null, lead: new Set(lead.keys()), carry });
      renderOwn(s, ctx);
      const boardEvent = ['frame', 'dive', 'rise', 'compare', 'tail'].includes(event.type) || ctx ? { kind: event.type === 'compare' ? 'frame' : event.kind || event.type, anchorId: event.anchorId, anchorRect: event.anchorRect } : {};
      const flipPlan = renderBoard(s, ctx && ctx.name !== 'local' ? ctx : null, { ...boardEvent, kind: motion ? boardEvent.kind : null, previous, lead, prepared });
      if (ctx?.name === 'turn') {
        traces(ctx, traceLayer, flipPlan);
        for (const item of carried) {
          const to = landing(item.key), record = answersOf(item.key, s)[0];
          const status = record ? answers.status(record, s.cursor) : null;
          if (to) fly(ctx, flyLayer, item, to, { solid: el => { el.classList.add('is-received'); const span = el.querySelector('.a-ask-answer span'); if (span && status) span.textContent = receiptLine(status); } });
        }
      }
    }
    renderBudget(s, ctx, waiting);
    if (ctx?.name === 'turn') {
      const ring = a => [{ outlineColor: `oklch(.56 .16 36 / ${a})` }];
      for (const el of host.querySelectorAll('.a-side .a-ask.is-new-ask, .a-board .a-paper.is-new-ask:not(.is-leaving) > .flip-shape')) {
        play(ctx, el, [{ ...ring(0)[0], outlineStyle: 'solid', outlineWidth: '2px', outlineOffset: '-2px', offset: 0 }, { ...ring(1)[0], outlineStyle: 'solid', outlineWidth: '2px', outlineOffset: '-2px', offset: 0.18 },
          { ...ring(1)[0], outlineStyle: 'solid', outlineWidth: '2px', outlineOffset: '-2px', offset: 0.55 }, { ...ring(0)[0], outlineStyle: 'solid', outlineWidth: '2px', outlineOffset: '-2px', offset: 1 }], [ctx.B.glow, 1.6], { easing: 'linear', fill: 'none' });
      }
    }
    if (ctx) { beat = ctx; adopt(ctx); }
    const wasFor = reader.hidden ? null : reader.dataset.for;
    renderReader(s);
    refreshDetail();
    cutWas = null;
    // Opening a reader moves the keyboard into it; Esc brings it back to the paper or card.
    if (event.type === 'select' && !reader.hidden && reader.dataset.for !== wasFor) reader.focus({ preventScroll: true });
    else restoreFocus(focusKey);
    if (turning || event.type === 'dive' || event.type === 'rise') say(`${$('.a-frame-title').textContent}，当前${s.layer.items.length}件事，占${s.layer.used}份，空着${s.layer.budget - s.layer.used}份${waiting ? `，${waiting}个问题等你` : ''}。`);
  }
  /**
   * The protagonists of a 整理 landing: items whose question you answered on this page and that closed or changed (step 0),
   * and items whose question closed without your answer (step 1, a beat later). They are carried, not thrown.
   */
  function leadsOf(previous, s) {
    const out = new Map();
    for (const entry of openAsks(previous)) {
      const id = entry.item.id, now = currentAsk(s, id);
      if (now?.id === entry.ask.id) continue;
      const mine = answers.list(s.cursor).some(record => record.item === id && record.ask === entry.ask.id && record.meaning !== 'snooze');
      if (mine) out.set(id, 0);
      else if (!now) out.set(id, 1);
    }
    return out;
  }
  // Re-rendered lists keep keyboard focus on the same control.
  function focusMemo() {
    const el = document.activeElement;
    if (!el || !host.contains(el) || el === document.body) return null;
    const region = el.closest('.a-reader') ? '.a-reader' : el.closest('.ix-detail') ? '.ix-detail' : el.closest('.a-side') ? '.a-side' : el.closest('.a-board') ? '.a-board .a-paper:not(.is-leaving) > .flip-body' : null;
    if (!region) return null;
    const attr = name => `[data-${name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${CSS.escape(el.dataset[name])}"]`;
    if (el.dataset.rsOpen) return `${region} ${attr('rsOpen')}${attr('rsKey')}`;
    for (const name of ['rsAct', 'rsDefer', 'aExpand', 'aUndo', 'aOpen', 'sharedSelect', 'sharedDive', 'aEvent', 'aAction', 'aFrame', 'aTail']) if (el.dataset[name] !== undefined) return `${region} ${attr(name)}`;
    return null;
  }
  function restoreFocus(selector) {
    if (!selector || host.contains(document.activeElement) && document.activeElement !== document.body) return;
    host.querySelector(selector)?.focus({ preventScroll: true });
  }
  const rerender = (type, extra = {}) => render(current, { type, previous: current, ...extra });

  // ---------- play: this page keeps its own clock (5.6 s a round from the cut), so a hover can hold it mid-round ----------

  function setPlaying(on) { playing = on; playT = 0; renderKeys(); }
  function togglePlay() {
    if (playing) { setPlaying(false); return; }
    if (current.index >= LAST) { advancing = true; model.goFrame(0); advancing = false; }
    setPlaying(true);
  }
  function advance() {
    if (current.index >= LAST) { setPlaying(false); return; }
    advancing = true; model.goFrame(current.index + 1); advancing = false;
    if (current.index >= LAST) setPlaying(false);
  }

  // ---------- answering ----------

  function answer(itemId, action, extra = {}) {
    const item = getItem(current.state, itemId), ask = item && currentAsk(current, itemId);
    if (!ask) return;
    if (playing) setPlaying(false); // what you just pressed is not swept away by the next round
    const origin = panel?.where || panelOrigin;
    panel = null;
    lastAnswer = answers.save(item, ask, action, current.cursor, extra);
    const name = lastAnswer.meaning === 'snooze' ? 'snooze' : 'answer';
    if (name === 'answer' && lastDown && performance.now() - lastDown.t < 900) guard = { x: lastDown.x, y: lastDown.y, until: performance.now() + BEATS.answer.guard * 1000 * (slow ? 3 : 1) };
    rerender('answer', { beat: name, target: itemId });
    say(`${answerWords(lastAnswer)} · ${lastAnswer.meaning === 'snooze' ? '先移到下方，到点再回来' : '已保存，等 Agent 下一轮整理；桌面还没变'}`);
    // The keyboard stays where the answer was given: on the receipt's undo, or on the next question after a snooze.
    const where = origin === 'reader' ? '.a-reader' : origin === 'detail' ? '.ix-detail' : '.a-side';
    const next = lastAnswer.meaning === 'snooze' ? host.querySelector(`${where} .a-ask[data-a-card] [data-rs-act]`) : host.querySelector(`${where} .a-ask[data-a-paper="${CSS.escape(itemId)}"] [data-a-undo]`);
    next?.focus({ preventScroll: true });
    return lastAnswer;
  }
  function answerAction(itemId, actionId) {
    const ask = normalizeAsk(currentAsk(current, itemId));
    const action = ask?.actions.find(entry => entry.id === actionId) || ask?.actions.find(entry => entry.meaning !== 'snooze' && entry.meaning !== 'input');
    return action ? answer(itemId, action) : null;
  }
  function undo(key) {
    const record = answers.store.list().find(entry => entry.key === key);
    if (!record) return;
    answers.undo(record);
    if (lastAnswer?.key === key) lastAnswer = null;
    if (demoKey === key) demoKey = null;
    rerender('answer', { beat: 'undo', target: record.item });
    say('已撤销，这个问题重新等你回应');
    host.querySelector(`.a-side .a-ask[data-a-paper="${CSS.escape(record.item)}"] [data-rs-act]`)?.focus({ preventScroll: true });
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

  // ---------- hovering and opening a paper (motion/ix.mjs) ----------

  /** A point near a paper but off it still counts, as long as it is not on another one (12 px band). */
  function hitAt(x, y) {
    let best = null, bestD = 12;
    for (const id of onBoard) {
      const r = shown.get(id);
      if (!r) continue;
      const dx = Math.max(r.x - x, 0, x - r.x - r.width), dy = Math.max(r.y - y, 0, y - r.y - r.height), d = Math.hypot(dx, dy);
      if (d < bestD) { best = id; bestD = d; }
    }
    return best;
  }
  function anchorOf(id) {
    const r = shown.get(id), W = wrap.clientWidth;
    if (!r) return { x: 0, y: 0, facing: 1 };
    const facing = W - r.x - r.width >= r.x ? 1 : -1;
    const keep = { x0: r.x - 6, y0: r.y - 6, x1: r.x + r.width + 6, y1: r.y + r.height + 6 };
    return { x: facing > 0 ? r.x + r.width + 4 : r.x - 4, y: r.y + Math.min(r.height / 2, 64), facing, keep };
  }
  const ix = createIx({
    stage: wrap, keysIn: wrap,
    facts: id => itemFacts(current.index, id), has: id => onBoard.has(id), hit: hitAt,
    pointOf: id => { const r = shown.get(id); return r ? { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 80) } : null; },
    anchor: anchorOf, index: () => current.index,
    named: name => (onBoard.has(name) ? name : [...onBoard].find(id => shortName(id) === name) || null),
    pause: () => setHeld(true), resume: () => setHeld(false), paused: () => held,
    last: LAST, answerHref: () => '#',
    // Stopped in the middle of a turn, the cards say only what the beats so far have shown.
    seen: () => { const T = beat?.name === 'turn' ? beatTime() : null; return T != null && T < BEATS.turn.settle ? { inputs: true, share: false, asks: T >= BEATS.turn.enter[0] } : ALL; },
    asks: (f, seen) => (seen.asks ? f.asks : f.asks.filter(a => { const ask = currentAsk(current, a.item); return !(ask?.id === a.id && isNewAsk(current, ask)); })),
    detailHTML: detailCardHTML, hug: 'keep', detailWidth: 330, trendH: 30,
    label: '桌面上的纸片：Tab 逐张看概要，Enter 展开详情，Esc 收回',
  });
  let X = ix.X, dimWas = -1, focusWas = null, popWas = '', cutWas = null;
  function paintIx() {
    // Everything but the one in focus steps back to seven tenths.
    const dim = X.focus ? X.dim : 0;
    if (Math.abs(dim - dimWas) > 0.002) { dimWas = dim; workspace.style.setProperty('--a-ix-dim', dim.toFixed(3)); workspace.classList.toggle('is-ix', dim > 0.001); }
    if (focusWas !== X.focus) {
      focusWas = X.focus;
      host.querySelectorAll('.is-ix-focus').forEach(el => el.classList.remove('is-ix-focus'));
      if (X.focus) { flip.element(X.focus)?.classList.add('is-ix-focus'); host.querySelectorAll(`.a-side [data-a-paper="${CSS.escape(X.focus)}"]`).forEach(el => el.classList.add('is-ix-focus')); }
    }
    // Opening: the paper steps out 8 px along its own frame (4 px each side), its shadow one step up.
    const popKey = X.popId && X.pop > 0.001 ? `${X.popId}:${X.pop.toFixed(3)}` : '';
    if (popKey !== popWas) {
      popWas = popKey;
      host.querySelectorAll('.a-paper.is-ix-pop').forEach(el => { el.classList.remove('is-ix-pop'); const shape = el.querySelector(':scope > .flip-shape'); shape.style.scale = ''; shape.style.translate = ''; });
      const tile = popKey && flip.element(X.popId), r = popKey && shown.get(X.popId);
      if (tile && r) {
        const k = X.pop, shape = tile.querySelector(':scope > .flip-shape');
        tile.classList.add('is-ix-pop');
        shape.style.scale = `${((r.width + 8 * k) / r.width).toFixed(4)} ${((r.height + 8 * k) / r.height).toFixed(4)}`;
        shape.style.translate = `${(-4 * k).toFixed(2)}px ${(-4 * k).toFixed(2)}px`;
      }
    }
    // Open: the heading and the desk's breadcrumb cut to “这一件”.
    const f = X.detail ? ix.view : null, key = f ? `${f.i}:${f.id}` : '';
    if (key !== cutWas) {
      cutWas = key;
      if (f) {
        const seen = ix.s.seen || ALL, share = seen.share ? f.share : f.before;
        $('.a-day').textContent = `第 ${f.i} / ${LAST} 轮`;
        $('.a-clock').textContent = `${f.short} ${share} / 64 份${seen.share && f.change ? ` · ${f.change.text}` : ''}`;
        $('.a-frame-title').textContent = `这一件 · ${f.title}`;
        $('.a-breadcrumb').innerHTML = `<button data-a-action="root">全部事项</button><span aria-hidden="true">/</span><span class="a-this" aria-current="page">这一件 · ${esc(f.short)}</span>`;
      } else { renderHeading(current); renderBreadcrumb(current); }
    }
  }

  // ---------- 自动讲一遍 ----------
  // Only when this page is the top window, was opened directly (no referrer) and its address had no ?frame= (explore.mjs
  // writes one in before this module runs, so read the address the page was loaded with).
  const topLevel = (() => { try { return window.top === window; } catch { return false; } })();
  const loadedWith = new URL(performance.getEntriesByType?.('navigation')?.[0]?.name || location.href);
  const direct = topLevel && !document.referrer && !loadedWith.searchParams.has('frame') && loadedWith.searchParams.get('embed') !== '1';
  // The sample of the dataset on screen. explore.mjs drops ?data= from the address after loading, so the name comes
  // from the address the page was loaded with, and each plan is checked against the replay itself.
  const tellPlan = (() => {
    const at = id => scenario.frames.findIndex(frame => frame.id === id);
    const named = TELL[loadedWith.searchParams.get('data') || currentDataset()];
    for (const plan of [named, ...Object.values(TELL)]) {
      if (!plan) continue;
      const out = { ...plan, from: at(plan.from), at: at(plan.at), to: at(plan.to) };
      if (![out.from, out.at, out.to].every(i => i >= 0)) continue;
      const ask = currentAsk({ index: out.at, state: records[out.at].state }, plan.item);
      if (ask && normalizeAsk(ask).actions.some(action => action.id === plan.action)) return out;
    }
    return null;
  })();
  const caption = text => { const el = $('.a-tell'); el.hidden = !text; el.innerHTML = text ? `<b>讲一遍</b> · ${esc(text)}<span>任意键跳过</span>` : ''; };
  function jump(i) { instantNext = true; advancing = true; model.goFrame(i); advancing = false; instantNext = false; }
  function goTold(i) { advancing = true; model.goFrame(i); advancing = false; }
  function press() {
    const P = tellPlan, button = host.querySelector(`.a-side [data-rs-act="${CSS.escape(`${P.item}:${P.action}`)}"]`);
    button?.classList.add('is-pressed');
    tell?.later.push(setTimeout(() => {
      button?.classList.remove('is-pressed');
      if (!currentAsk(current, P.item) || answers.find(P.item, current.cursor, currentAsk(current, P.item).id)) return;
      const record = answerAction(P.item, P.action);
      demoKey = record?.key || null;
    }, 140));
  }
  function startTell() {
    if (!tellPlan || reduced()) return;
    stopTell();
    told = true;
    if (playing) setPlaying(false);
    ix.reset(); pinAt(null);
    if (demoKey) { const record = answers.store.list().find(entry => entry.key === demoKey); if (record) answers.undo(record); demoKey = null; }
    jump(tellPlan.from);
    const P = tellPlan;
    tell = { t: 0, next: 0, later: [], steps: [
      [0, () => caption('1 换轮')],
      [0.9, () => goTold(P.at)],
      [2.3, () => { caption('2 答一件'); press(); }],
      [5.2, () => { caption('3 让位'); goTold(P.to); }],
      [6.6, () => { if (onBoard.has(P.item) && !ix.s.hover && !ix.s.open) ix.hover(P.item, 'tour'); }],
      [8.9, () => stopTell()],
    ] };
    renderKeys();
  }
  function stopTell(skip = false) {
    if (!tell) return;
    const P = tellPlan;
    tell.later.forEach(clearTimeout);
    tell = null;
    caption('');
    if (ix.s.via === 'tour') ix.hover(null, 'now');
    if (skip) {
      finishBeat();
      // The end state is the same whenever it is skipped: f23 (story f15) with the answer the tell gave.
      if (!answers.list(Infinity).some(record => record.item === P.item && record.action === P.action)) {
        if (current.index !== P.at) jump(P.at);
        const record = answerAction(P.item, P.action);
        demoKey = record?.key || null;
      }
      if (current.index !== P.to) jump(P.to);
      finishBeat();
    }
    renderKeys();
  }
  function tickTell(dt) {
    if (!tell || held) return;
    tell.t += dt;
    while (tell && tell.next < tell.steps.length && tell.steps[tell.next][0] <= tell.t) { const [, fn] = tell.steps[tell.next]; tell.next += 1; fn(); }
  }

  // ---------- events ----------

  function closeReader() {
    const selected = current.selectedId;
    readerEvent = null;
    if (selected) model.select(null); else renderReader(current);
    const target = selected && (host.querySelector(`.a-side .a-ask[data-a-paper="${CSS.escape(selected)}"] button`) || board.querySelector(`.a-paper[data-id="${CSS.escape(selected)}"]:not(.is-leaving) > .flip-body .a-paper-main`));
    (target || $('[data-a-action="root"]')).focus({ preventScroll: true });
  }
  function setTail(open) {
    if (tailOpen === open) return;
    const anchorRect = open ? flip.rect(TAIL_ID) : null;
    tailOpen = open;
    if (playing) setPlaying(false);
    render(current, { type: 'tail', kind: open ? 'dive' : 'rise', anchorId: TAIL_ID, anchorRect, previous: current });
    (open ? board.querySelector('.a-paper:not(.is-leaving) > .flip-body .a-paper-main') : board.querySelector(`.a-paper[data-id="${TAIL_ID}"]:not(.is-leaving) > .flip-body .a-paper-main`))?.focus({ preventScroll: true });
  }
  function onKeyDown(event) {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    // Any key skips the tell, and is spent on skipping.
    if (tell) { event.preventDefault(); event.stopImmediatePropagation(); stopTell(true); return; }
    if (!document.getElementById('lab-inspector')?.hidden || !document.getElementById('lab-about')?.hidden) return;
    const typing = event.target.matches?.('input,textarea,select');
    if (event.key === 'Escape') {
      if (baseOpen) return;
      if (panel) {
        const where = panel.where, key = panel.key;
        panel = null; rerender('panel'); event.preventDefault(); event.stopImmediatePropagation();
        host.querySelector(`${where === 'reader' ? '.a-reader' : where === 'detail' ? '.ix-detail' : '.a-side'} [data-rs-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
        return;
      }
      if (typing) return;
      if (ix.s.open || ix.s.hover) return; // ix folds its card first
      if (!reader.hidden) { event.preventDefault(); event.stopImmediatePropagation(); closeReader(); return; }
      if (tailOpen) { event.preventDefault(); event.stopImmediatePropagation(); setTail(false); return; }
      return;
    }
    if (typing) return;
    // Space plays this page's own clock (the lab's model timer is not used).
    if (event.key === ' ' && !event.target.closest?.('button,a,summary')) { event.preventDefault(); event.stopImmediatePropagation(); togglePlay(); return; }
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
    const el = event.target.closest('[data-a-action],[data-a-undo],[data-a-expand],[data-a-event],[data-a-tail],[data-a-frame],[data-a-open]');
    if (!el || !host.contains(el)) return;
    const d = el.dataset;
    if (d.aUndo) { undo(d.aUndo); return; }
    if (d.aOpen) { if (onBoard.has(d.aOpen)) ix.open(d.aOpen); return; }
    if (d.aExpand) { expanded.has(d.aExpand) ? expanded.delete(d.aExpand) : expanded.add(d.aExpand); rerender('panel'); host.querySelector(`[data-a-expand="${CSS.escape(d.aExpand)}"], .a-ask[data-a-card] [data-rs-act]`)?.focus({ preventScroll: true }); return; }
    if (d.aEvent) { readerEvent = d.aEvent; ix.reset(); renderReader(current); $('.a-reader-top button').focus({ preventScroll: true }); return; }
    if (d.aTail !== undefined) { setTail(true); return; }
    if (d.aFrame) { model.goFrame(Number(d.aFrame)); return; }
    const action = d.aAction;
    if (action === 'root') { if (tailOpen) setTail(false); else model.goRoot(); }
    else if (action === 'tail') setTail(true);
    else if (action === 'first') model.goFrame(1);
    else if (action === 'previous') model.goFrame(current.index - 1);
    else if (action === 'next') model.goFrame(current.index + 1);
    else if (action === 'play') togglePlay();
    else if (action === 'compare') model.setCompare(!current.comparing);
    else if (action === 'more-asks') { showFolded = !showFolded; rerender('panel'); $('[data-a-action="more-asks"]')?.focus({ preventScroll: true }); }
    else if (action === 'more-own') { showAllOwn = !showAllOwn; finishBeat(); const ctx = reduced() ? null : newBeat('local'); renderOwn(current, ctx); if (ctx) { beat = ctx; adopt(ctx); } $('[data-a-action="more-own"]')?.focus({ preventScroll: true }); }
    else if (action === 'panel-close') { panel = null; rerender('panel'); }
    else if (action === 'slow') { slow = !slow; el.setAttribute('aria-pressed', String(slow)); el.textContent = slow ? '慢速中' : '慢速'; }
    else if (action === 'replay') replayTurn();
    else if (action === 'tell') { if (tell) stopTell(true); else startTell(); }
    else if (action === 'close') closeReader();
  }
  /** 重播这一轮：back to the round before, at once, then the same turn again. */
  function replayTurn() {
    if (!lastTurnFrom || lastTurnFrom.index === current.index) return;
    const to = model.snapshot(), from = lastTurnFrom;
    if (playing) setPlaying(false);
    render(from, { type: 'frame', instant: true, previous: to });
    render(to, { type: 'frame', previous: from });
  }
  // Hovering or focusing a card, a row or an action points at its paper; a paper points back at its card.
  function link(event) {
    const source = event.target.closest?.('[data-a-paper]');
    host.querySelectorAll('.a-paper.is-linked, .a-ask.is-linked, .a-ask-row.is-linked').forEach(el => el.classList.remove('is-linked'));
    const entering = event.type === 'pointerover' || event.type === 'focusin';
    const paper = entering && !source && event.target.closest?.('.a-paper:not(.is-leaving)');
    if (paper) host.querySelectorAll(`.a-side [data-a-paper="${CSS.escape(paper.dataset.id)}"]`).forEach(el => el.matches('.a-ask, .a-ask-row') && el.classList.add('is-linked'));
    if (!source || !entering) return;
    const id = source.dataset.aPaper;
    (board.querySelector(`.a-paper[data-id="${CSS.escape(id)}"]:not(.is-leaving)`) || (tailState(current).tail.some(item => item.id === id) ? board.querySelector(`.a-paper[data-id="${TAIL_ID}"]`) : null))?.classList.add('is-linked');
  }
  // After an answer the next card slides up under the pointer: for a moment, a second press there does not land on it.
  const onDown = event => { lastDown = { x: event.clientX, y: event.clientY, t: performance.now() }; if (tell && !event.target.closest?.('[data-a-action="tell"]')) stopTell(true); };
  const onGuard = event => {
    if (!guard || event.detail === 0 || performance.now() > guard.until) return;
    if (Math.hypot(event.clientX - guard.x, event.clientY - guard.y) > 32 || event.target.closest?.('[data-a-undo]')) return;
    event.preventDefault(); event.stopPropagation();
  };

  // Custom frame slider: pointer drag plus the standard slider keys.
  const frameAt = clientX => { const box = slider.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * LAST); };
  const goTo = index => { if (index !== current.index) model.goFrame(index); };
  function onSliderDown(event) {
    if (event.button !== 0) return;
    dragging = true; slider.setPointerCapture(event.pointerId); slider.classList.add('is-dragging');
    slider.focus({ preventScroll: true }); goTo(frameAt(event.clientX)); event.preventDefault();
  }
  const onSliderMove = event => { if (dragging) goTo(frameAt(event.clientX)); };
  const onSliderUp = () => { dragging = false; slider.classList.remove('is-dragging'); };
  function onSliderKey(event) {
    const next = { ArrowLeft: current.index - 1, ArrowDown: current.index - 1, ArrowRight: current.index + 1, ArrowUp: current.index + 1, PageDown: current.index - 5, PageUp: current.index + 5, Home: 0, End: LAST }[event.key];
    if (next === undefined || event.altKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault(); event.stopPropagation(); goTo(Math.max(0, Math.min(LAST, next)));
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
    render(s, event.type === 'frame' ? { ...event, kind: 'frame', instant: instantNext } : event);
  }

  const notePanelOrigin = event => { panelOrigin = event.target.closest?.('.a-reader') ? 'reader' : event.target.closest?.('.ix-detail') ? 'detail' : 'side'; };
  host.addEventListener('click', notePanelOrigin, true);
  host.addEventListener('keydown', notePanelOrigin, true);
  host.addEventListener('pointerdown', onDown, true);
  host.addEventListener('click', onGuard, true);
  host.addEventListener('click', click);
  host.addEventListener('pointerover', link); host.addEventListener('pointerout', link);
  host.addEventListener('focusin', link); host.addEventListener('focusout', link);
  document.addEventListener('keydown', onKeyDown, true);
  const onHidden = () => { if (document.hidden && playing) setPlaying(false); };
  document.addEventListener('visibilitychange', onHidden);
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
    resizeFrame = requestAnimationFrame(() => { if (disposed) return; finishBeat(); renderBoard(current, null, {}); ix.relayout(); });
  });
  observer.observe(board);
  const unsubscribe = model.subscribe(subscriber);

  // One loop: the shared module's state machine, this page's play clock and the tell.
  let lastNow = 0, raf = 0;
  function loop(now) {
    if (disposed) return;
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    lastNow = now;
    X = ix.frame();
    paintIx();
    ix.paint();
    ix.sync(`${current.index}:${tailOpen}:${current.layerId || ''}:${[...onBoard].join(',')}`, () => [...onBoard].map(id => { const r = shown.get(id), item = getItem(current.state, id), ask = currentAsk(current, id); return { id, label: `${item?.title || id} · ${r?.share ?? item?.share ?? ''} 份${ask ? ` · ${askWord(normalizeAsk(ask))}` : ''}` }; }));
    if (playing && !held && !tell) { playT += dt; if (playT >= PLAY * (slow ? 1.5 : 1)) { playT = 0; advance(); } }
    tickTell(dt);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  window.foldA = {
    ...ix.hooks(),
    model,
    get index() { return current.index; },
    go: i => model.goFrame(i),
    play: () => { if (!playing) togglePlay(); }, stop: () => setPlaying(false), playing: () => playing,
    // Pin the beat on screen (a turn or a press) at t seconds from its cut; null lets it run.
    beatAt: t => pinAt(t), beat: () => beatTime(), beatName: () => beat?.name || null,
    answer: (id, action) => answerAction(id, action), undo: id => { const record = answersOf(id)[0] || answers.list(current.cursor).find(r => r.item === id); if (record) undo(record.key); },
    waiting: () => askPlan(current).all.filter(entry => !entry.answer).length,
    blank: () => current.layer.budget - current.layer.used,
    papers: () => [...shown].map(([id, r]) => ({ id, ...r, root: onBoard.has(id) })),
    // The largest paper on the desk (what checks hover), and a point px outside it that is on no other paper.
    pick: () => [...onBoard].sort((a, b) => (shown.get(b)?.share || 0) - (shown.get(a)?.share || 0))[0] || null,
    nearOf: (name, px = 9) => {
      const id = onBoard.has(name) ? name : [...onBoard].find(x => shortName(x) === name), r = id && shown.get(id);
      if (!r) return null;
      const box = wrap.getBoundingClientRect(), W = wrap.clientWidth, H = wrap.clientHeight;
      const tries = [[r.x - px, r.y + r.height / 2], [r.x + r.width + px, r.y + r.height / 2], [r.x + r.width / 2, r.y - px], [r.x + r.width / 2, r.y + r.height + px]];
      const free = ([x, y]) => x > 1 && y > 1 && x < W - 1 && y < H - 1 && ![...shown].some(([other, q]) => other !== id && x >= q.x - 2 && x <= q.x + q.width + 2 && y >= q.y - 2 && y <= q.y + q.height + 2);
      const p = tries.find(free) || tries[0];
      return { x: box.left + p[0], y: box.top + p[1] };
    },
    facts: id => itemFacts(current.index, id),
    tell: () => startTell(), skip: () => stopTell(true), telling: () => Boolean(tell),
  };
  // Read-only inspection makes the encoded area and the answers checkable in the lab.
  host.foldPaperInspection = () => ({ layerId: current.layerId, tailOpen, used: current.layer.used, budget: current.layer.budget,
    ...paperEntries(current, board.clientWidth, board.clientHeight).layout, motion: flip.inspect(), answers: answers.list() });
  renderKeys();
  if (direct && !told && tellPlan && !reduced()) { told = true; startTell(); }
  return () => {
    disposed = true; cancelAnimationFrame(raf); stopTell(); finishBeat(); ix.reset();
    unsubscribe(); observer.disconnect(); cancelAnimationFrame(resizeFrame); unbindResponses();
    flip.clear(); host.removeEventListener('click', click); host.removeEventListener('click', notePanelOrigin, true); host.removeEventListener('keydown', notePanelOrigin, true);
    host.removeEventListener('pointerdown', onDown, true); host.removeEventListener('click', onGuard, true);
    host.removeEventListener('pointerover', link); host.removeEventListener('pointerout', link);
    host.removeEventListener('focusin', link); host.removeEventListener('focusout', link);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('visibilitychange', onHidden);
    if (window.foldA?.model === model) delete window.foldA;
    delete host.foldPaperInspection;
  };
}
