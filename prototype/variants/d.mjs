import { escapeHTML as esc, formatDate, formatTime, kindLabel, getItem, colorFor, findEvent, currentAsk, feedbackTrail, scenario, personName, familyMove } from './shared.mjs?v=feedback-loop-1';
import { createResponseStore, responseHTML, composerHTML, keypadHTML, deferHTML, scheduleHTML, bindResponses, setTimeZone, normalizeAsk, responseStatus } from '../respond.mjs?v=respond-1';
import { IX, peekHTML, detailHTML as ixDetailHTML } from '../forms/motion/ix.mjs';
import { itemFacts, orderOf } from '../forms/motion/dial-model.mjs';
import { EASE, EASE_IN, EASE_IN_OUT, BEATS, STAGGER, STAGGER_MAX, GROW, SHRINK, PRESS, popKeys, play, stepAt, lookOf, makeBox,
  measureEl, ghostOf, morph, reveal, slideFrom, roll, band, gather } from './d-motion.mjs';
import { TOP, HOUR, DAY, WEIGHT_RANK, WEIGHT_WORD, WEIGHT_NAME, EXPECT_WORD, meaningLabel, surfaces, RS, dayLong, weekday, clock, stamp, span,
  actionWords, createHomeView } from './d-view.mjs';

// D · 手机首页。人离开半天回来，手机上第一屏回答三件事：几件等我、最急的是哪件、它为什么在这里。
// 首页只放最急的 3 张大卡（档位优先，同档看 due_at，再看份额），其余问题折成一个计数；
// 进行中与结果是纸面上的行；low / trace 的长尾折成一行“另有 N 项次要事项”（与文字简报的尾注同一规则）。
// 本页点按的回应只留在内存里演示，不写回状态、不持久化：先“已保存”，推进到下一轮整理后变为“已收到”。
// 回应跟着条目走：Agent 改写条目后重登记同一个问题，回执仍在；问题关上后，回执留在那一行下面。
// 控件、面板与记录来自 ../respond.mjs；D 把它们映射到自己的类名。
//
// 动画（forms/polish/home-motion.md）：只在三种时刻动——一轮整理落地；你作答、撤回或稍后；你展开或收起。
// 每次重绘按 data-key 只换变了的叶子，再按节拍表（d-motion.mjs BEATS）分组编排：切点换字 → 回执确认 → 英雄数字 →
// 离场 → 主角 → 移位 → 进场 → 新问题描边；同一件事的行、卡、回执、详情是同一个盒子变形，每个元素一次只走一段。
// 手势：轻点按钮作答、轻点卡或行从它自己长出详情、长按 0.45 秒代替悬停出概要卡、进行中的行左滑知道了、
// 详情到顶时下拉跟手收回；左缘右滑交给 Safari（详情开着时它等于收回），首页的下拉与右滑不绑定。
// 概要卡与详情里的“份额 · 逐轮”“本轮进了它”来自共用交互模块 ../forms/motion/ix.mjs，时序取它的 IX。
// What a long press (or keyboard focus) can summarise, what a tap can open.
const ROWS = '.d-ask-row, .d-line, .d-tail-item';
const OPENS = `.d-card, ${ROWS}`;
const PRESSABLE = `${OPENS}, .d-fold`;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerpRect = (a, b, q) => ({ x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, w: a.w + (b.w - a.w) * q, h: a.h + (b.h - a.h) * q });

export function mount(host, model) {
  let s = model.snapshot(), surface = new URLSearchParams(location.search).get('surface') === 'inbox' ? 'inbox' : 'focus';
  let disposed = false, lastIndex = s.index, sheetReturn = null, turnPending = false, restoring = false;
  const open = { more: false, tail: false };
  const responses = createResponseStore(); // in memory only: Safari's back swipe or a reload loses them (home-motion.md 1.4)
  const drafts = new Map(); // item:action -> amount being edited
  const textDrafts = new Map(); // data-rs-text key -> unsent reply
  const detailStack = [];
  const pulsed = new Set(); // frame:item pairs whose “new question” glow has played
  const embedded = window.parent !== window;
  const view = createHomeView({ s, responses, open, drafts, surfaceOf: () => surface });
  const { isAnswer, recordOf, answersFor, answeredRecord, askOfRecord, priorRecord, snoozedItems, woke, storyReminder, lapsedAsk, dueOf, dueWords, urgencyKey, byUrgency, compose, whyHTML, traceOf, snoozeButton, answerHTML, answerWords, receivedWords, receiptFor, dot, bigCardHTML, answeredHTML, askRowHTML, chipHTML, moreToggleHTML, statusWord, rowHTML, tailToggleHTML, tailItemHTML, buildView, headView, sinceHTML, askAt, historyOf, stepHTML, sourceHTML, ixSections, detailParts, detailControls } = view;

  host.innerHTML = `<div class="d-stage">
    <aside class="d-rail" aria-label="回放与读法">
      <div class="d-rail-brand">Fold <span>手机首页</span></div>
      <div class="d-rail-time"><span class="d-rail-date"></span><h1 class="d-rail-title"></h1><p class="d-rail-signal"></p></div>
      <div class="d-rail-steps"><button data-d="prev" aria-label="上一轮整理">‹</button><button data-d="play" class="d-play" aria-label="播放"><span aria-hidden="true">▶</span></button><div class="d-track" role="slider" tabindex="0" aria-label="选择整理时刻"><span class="d-track-line"></span><span class="d-track-ticks"></span><span class="d-track-thumb"></span></div><button data-d="next" aria-label="下一轮整理">›</button></div>
      <p class="d-rail-narrative"></p>
      <section class="d-rail-block"><h2>这块屏幕的用途</h2><div class="d-surface-toggle" role="radiogroup" aria-label="业务用途">${surfaces.map(x => `<button role="radio" data-surface="${x.id}">${esc(x.label)}</button>`).join('')}</div><p class="d-surface-policy"></p></section>
      <section class="d-rail-block"><h2>比较起点</h2><div class="d-base"><span>上次看到</span><button class="d-base-btn" data-d="base" aria-haspopup="listbox" aria-expanded="false"></button></div><div class="d-base-menu" role="listbox" aria-label="比较起点" hidden></div><p class="d-small">首切片不记录查看，这里由你指定；产品需要新增查看记录才能自动给出。</p></section>
      <section class="d-rail-block d-legend"><h2>读法</h2><ol>
        <li><b>先看大字</b>几件等你回应；下面一行是上次看过之后收到多少、新登记几个问题。</li>
        <li><b>大卡 = 最急的 3 件</b>档位高的在前，同档看截止时间。卡顶写它为什么在这里：档位、截止、新问题、等了多久。按钮形态说明怎么答：<span class="d-chip-demo is-fill">选项</span>决定、<span class="d-chip-demo">回一句</span>提供、<span class="d-chip-demo">我已处理</span>去做。</li>
        <li><b>其余问题折成一行</b>点开看全部，每件都能直接作答。</li>
        <li><b>纸面上的行 = 进行中与结果</b>没有按钮、没有颜色，左滑表示知道了。low 与 trace 档折成“另有 N 项次要事项”。</li>
        <li><b>你在原处做的事</b>在 GitHub、问答站上的处理写成动作句；没指回这张卡的问题时，会写“这个问题还开着”。</li>
        <li><b>手势</b>轻点按钮作答；轻点卡或行看详情（详情到顶时下拉收回）；长按行看概要；进行中的行左滑表示知道了。</li>
        <li><b>键盘</b>← → 换整理时刻 · 空格播放 · Tab 到卡片与行（行上出概要）· Enter 或空格看详情 · Esc 返回。</li>
      </ol></section>
      <p class="d-small">在这里点按的回应只留在本页内存里演示，不写回状态，刷新即清空：先“已保存”，推进到下一轮整理后变为“已收到”。<button class="d-link" data-d="reset">清除本页回应</button></p>
    </aside>
    <div class="d-device"><div class="d-phone"><div class="d-screen" tabindex="-1">
      <div class="d-statusbar"><span class="d-status-time"></span><span class="d-island"></span><span class="d-status-icons" aria-hidden="true">●●● ◗ ▭</span></div>
      <div class="d-scroll">
        <header class="d-head"><div class="d-head-main"><div class="d-date"></div><span class="d-head-tools"><button class="d-snoozed" data-d="snoozed" hidden></button><button class="d-log-btn" data-d="log" aria-label="我的回应记录">记录</button></span></div>
          <h1 class="d-headline" aria-live="polite"></h1><p class="d-since"></p><p class="d-signal" hidden></p></header>
        <section class="d-cards" aria-label="等你回应"></section>
        <section class="d-rows" aria-label="进行中与结果"></section>
        <section class="d-known" aria-label="次要事项"></section>
      </div>
      <div class="d-peek" role="tooltip" hidden></div>
      <button class="d-fold" data-d="fold" aria-label="查看被折叠的输入与本轮变化"><span class="d-fold-tex" aria-hidden="true"></span><span class="d-fold-text"></span><span class="d-fold-more" aria-hidden="true">›</span><span class="d-band" aria-hidden="true"></span></button>
      <section class="d-detail" aria-label="事项详情" hidden><div class="d-detail-bg" aria-hidden="true"></div><div class="d-detail-bar"></div><div class="d-detail-body"></div><div class="d-detail-actions"></div></section>
      <div class="d-sheet-backdrop" hidden></div><section class="d-sheet" role="dialog" aria-label="操作" hidden></section>
      <div class="d-toast" role="status" aria-live="polite"></div><p class="d-sr" aria-live="polite"></p>
    </div></div></div>
  </div>`;
  const $ = selector => host.querySelector(selector);
  const scroll = $('.d-scroll'), screenEl = $('.d-screen'), peekEl = $('.d-peek'), bandEl = $('.d-band');
  const panel = $('.d-detail'), panelBg = $('.d-detail-bg'), panelBar = $('.d-detail-bar'), panelBody = $('.d-detail-body'), panelActions = $('.d-detail-actions');
  const track = $('.d-track');
  // The shared module's styles (summary card, the detail's share bars), themed by d.css. Relative to index.html.
  if (!document.querySelector('link[data-ix-css]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.dataset.ixCss = ''; link.href = './forms/motion/ix.css'; document.head.prepend(link); }
  // Safari has no scroll anchoring; D keeps what you read in place itself (keepAnchor), so Chrome's own is switched off.
  const anchorWas = document.documentElement.style.overflowAnchor;
  document.documentElement.style.overflowAnchor = 'none';

  const ACK = { id: 'ack', label: '已阅', meaning: 'ack' };
  /** Save a response and play its beat: an answer folds the card into a receipt under your finger. */
  function give(item, action, value, until, opts = {}) {
    if (!item) return;
    if (s.playing && action.meaning !== 'ack') model.pause(); // what you just pressed is not swept away by the next round
    const record = responses.save(item, action, { ask: currentAsk(s, item.id), value, until, at: s.cursor });
    say(record.meaning === 'ack' || record.meaning === 'snooze' ? answerWords(record) : `已保存 · ${answerWords(record, currentAsk(s, item.id))}`);
    const name = record.meaning === 'snooze' ? 'snooze' : record.meaning === 'ack' ? 'local' : 'answer';
    if (name === 'answer' && lastDown && performance.now() - lastDown.t < 900) guard = { x: lastDown.x, y: lastDown.y, id: item.id, until: performance.now() + BEATS.answer.guard * 1000 };
    render(name, { target: item.id, ...opts });
  }


  // ---------- keyed patch ----------
  const toNode = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  /** Replace only the leaves whose markup changed; keep order. Returns removed and replaced nodes by key. */
  function patch(container, entries, removed, replaced) {
    const existing = new Map();
    for (const node of [...container.children]) { if (node.dataset.key) existing.set(node.dataset.key, node); else node.remove(); }
    let prev = null;
    for (const { key, html } of entries) {
      let node = existing.get(key);
      existing.delete(key);
      if (node && node.__html !== html) { const fresh = toNode(html); fresh.__html = html; replaced.set(key, node); node.replaceWith(fresh); node = fresh; }
      else if (!node) { node = toNode(html); node.__html = html; }
      const want = prev ? prev.nextElementSibling : container.firstElementChild;
      if (node !== want) container.insertBefore(node, want);
      prev = node;
    }
    for (const [key, node] of existing) { removed.set(key, node); node.remove(); }
  }
  const same = (container, entries) => {
    const kids = [...container.children].filter(n => n.dataset.key);
    return kids.length === entries.length && entries.every((e, j) => kids[j].dataset.key === e.key && kids[j].__html === e.html);
  };
  const scale = () => { const phone = $('.d-phone'); return phone.offsetWidth ? phone.getBoundingClientRect().width / phone.offsetWidth : 1; };
  const ownScroll = () => getComputedStyle(scroll).overflowY !== 'visible';
  const homeEl = id => id && scroll.querySelector(`[data-key="i:${CSS.escape(id)}"]`);
  /** A fold opened near the bottom: scroll just enough to show its first rows, in the phone (or the page on a real phone), never the host page. */
  function revealOpened(key) {
    const row = scroll.querySelector(`[data-key="${key}"]`);
    if (!row) return;
    const own = ownScroll(), k = own ? scale() || 1 : 1;
    const box = own ? scroll.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    const fold = $('.d-fold')?.getBoundingClientRect(); // the 累计 bar floats over the bottom
    const bottom = Math.min(box.bottom, fold?.height ? fold.top - 8 * k : box.bottom);
    const r = row.getBoundingClientRect();
    const want = Math.min(r.top + 300 * k - bottom, r.top - box.top - 12 * k); // the fold header plus about three rows
    if (want > 4) (own ? scroll : window).scrollBy({ top: want / k, behavior: reduced() ? 'auto' : 'smooth' });
  }
  const TOP_LEVEL = '.d-cards > [data-key], .d-rows > [data-key], .d-known > [data-key]';
  function measureAll(k) {
    const map = new Map();
    for (const el of scroll.querySelectorAll(TOP_LEVEL)) map.set(el.dataset.key, measureEl(el, k));
    return map;
  }
  // Scroll anchoring by hand (Safari has none): what you are reading, or the item you just acted on, stays where it was.
  function pickAnchor(prefer) {
    const own = ownScroll();
    if ((own ? scroll.scrollTop : scrollY) <= 0) return null;
    const top = own ? scroll.getBoundingClientRect().top : Math.max(0, $('.d-rail').getBoundingClientRect().bottom);
    const list = [...scroll.querySelectorAll(TOP_LEVEL)];
    const el = (prefer && list.find(x => x.dataset.key === prefer)) || list.find(x => x.getBoundingClientRect().bottom > top + 1);
    return el ? { key: el.dataset.key, top: el.getBoundingClientRect().top, own } : null;
  }
  function keepAnchor(a, k) {
    const el = a && scroll.querySelector(`[data-key="${CSS.escape(a.key)}"]`);
    if (!el) return;
    const d = el.getBoundingClientRect().top - a.top;
    if (Math.abs(d) < 0.5) return;
    if (a.own) scroll.scrollTop += d / k; else scrollBy(0, d);
  }

  // ---------- beats: every animation of one moment, ended together ----------
  let pinned = null; // foldHome.ixAt(seconds): every running animation held at that moment (stills and checks)
  function newCtx() {
    const c = { anims: [], cleanups: [], done: false };
    c.add = a => { if (pinned != null) { a.pause(); a.currentTime = pinned * 1000; } c.anims.push(a); return a; };
    c.clean = fn => { c.cleanups.push(fn); };
    return c;
  }
  /** End a beat now: every animation to its final state, its ghosts and boxes removed. */
  function settle(c) {
    if (!c || c.done) return;
    c.done = true;
    clearTimeout(c.timer);
    for (const a of c.anims) a.cancel();
    for (const fn of c.cleanups.splice(0).reverse()) { try { fn(); } catch (error) { console.error(error); } }
    const after = c.after; c.after = null;
    after?.();
  }
  /** When every animation of the beat has run, end it; a timer covers a background tab (and waits while pinned). */
  function arm(c, after = null) {
    c.after = after;
    if (!c.anims.length) { settle(c); return; }
    const end = Math.max(...c.anims.map(a => a.effect?.getComputedTiming().endTime || 0));
    Promise.all(c.anims.map(a => a.finished.catch(() => {}))).then(() => { if (pinned == null) settle(c); });
    const fallback = () => { c.timer = setTimeout(() => { if (pinned != null) fallback(); else settle(c); }, end + 300); };
    fallback();
  }
  function pin(sec) {
    pinned = sec == null ? null : Math.max(0, Number(sec));
    for (const a of host.getAnimations({ subtree: true })) {
      if (pinned == null) { if (a.playState === 'paused') a.play(); } else { a.pause(); a.currentTime = pinned * 1000; }
    }
    if (pinned == null) for (const c of [beat, detail.ctx, peekOut]) if (c && !c.done && c.anims.every(a => a.playState === 'finished')) settle(c);
  }

  let beat = null, prevFolded = new Map();
  /** Patch the page, then play the beat `name` from where things were to where they are now. */
  function update(view, name, opts = {}) {
    const B = BEATS[name] || null;
    const animate = Boolean(B) && !reduced() && !document.hidden && scroll.offsetParent !== null;
    const k = scale() || 1;
    const before = animate ? measureAll(k) : null; // where things are seen now, mid-flight included
    settle(beat); beat = null;
    const anchor = pickAnchor(opts.target ? `i:${opts.target}` : null);
    const removed = new Map(), replaced = new Map();
    const focus = focusMark();
    scroll.style.setProperty('--glow-delay', `${animate ? B.glow : 0.25}s`);
    patch($('.d-cards'), view.cards, removed, replaced);
    patch($('.d-rows'), view.rows, removed, replaced);
    patch($('.d-known'), view.tail, removed, replaced);
    const fx = renderHead(view.head);
    markNew();
    restoring = true; // focus coming back to a row after a re-render is not a new keyboard visit: no summary
    restoreFocus(focus);
    restoring = false;
    restoreDrafts();
    const wasFolded = prevFolded;
    prevFolded = view.folded;
    keepAnchor(anchor, k);
    const ctx = beat = newCtx();
    // Everything the beat needs from layout is read here, once; from now on it only writes.
    const geo = { band: bandEl.clientWidth, tex: $('.d-fold-tex').offsetHeight || 48 };
    if (!animate) { headEffects(ctx, fx, null, name, geo); settle(ctx); beat = null; return; }
    const after = measureAll(k);
    geo.hosts = new Map([...host.querySelectorAll('.d-cards, .d-rows, .d-known')].map(x => [x, x.getBoundingClientRect()]));
    geo.chip = name === 'snooze' ? $('.d-snoozed:not([hidden])')?.getBoundingClientRect() : null;
    choreograph(ctx, B, name, { before, after, removed, replaced, wasFolded, folded: view.folded, k, opts, geo });
    headEffects(ctx, fx, B, name, geo);
    arm(ctx);
  }
  /** Who moves in which group (home-motion.md 3.2, 3.4 and 4.2). */
  function choreograph(ctx, B, name, { before, after, removed, replaced, wasFolded, folded, k, opts, geo }) {
    // An item that changed zone (a card that sank to the rows) was removed from one list and added to another: one move.
    for (const [key, node] of removed) if (after.has(key)) { replaced.set(key, node); removed.delete(key); }
    const self = opts.target ? `i:${opts.target}` : null;
    // A 整理 landing's protagonists: your receipts first, then the cards that sink to the rows, 0.06 s apart.
    const leads = new Map();
    if (name === 'turn') {
      const list = [];
      for (const [key, now] of after) {
        const was = before.get(key);
        if (!was || !key.startsWith('i:')) continue;
        const mine = was.el.matches('.d-card.is-answered');
        const sinks = was.zone.includes('d-cards') && !now.zone.includes('d-cards') && was.el.matches('.d-card');
        if (mine || sinks) list.push({ key, mine, top: now.top });
      }
      list.sort((a, b) => (b.mine - a.mine) || (a.top - b.top)).forEach((x, j) => leads.set(x.key, { ...x, j }));
    }
    const entering = [];
    for (const [key, now] of after) {
      const was = before.get(key);
      if (!was) { entering.push([key, now]); continue; }
      const el = now.el, old = replaced.get(key) || null, lead = leads.get(key);
      let t;
      if (key === self && B.self) {
        const S = B.self;
        t = { move: S.box, box: S.box, parts: S.box, out: S.out, in: S.in, fresh: S.in, flip: B.flip, settle: S.box[0] + S.box[1] };
      } else if (lead) {
        const d = lead.j * B.leadStep, face = [B.leadFace[0] + d, B.leadFace[1]];
        // Carried, not thrown: eased in and out, so the cards that close the gap behind it start before it is far away.
        t = { move: [B.lead[0] + d, B.lead[1]], box: face, parts: face, out: [face[0], 0.12], in: face, fresh: face, flip: B.flip, settle: face[0] + face[1], z: 3 + leads.size - lead.j, ease: EASE_IN_OUT };
        // A receipt that stays a receipt shows 已收到 at the cut and only fills in; it does not crossfade later.
        if (lead.mine && el.querySelector('.d-receipt')) t.keep = new Set(['receipt']);
      } else {
        t = { move: B.move, box: B.move, parts: B.move, out: [B.move[0], B.move[1] * 0.4], in: B.swap, fresh: B.fresh, flip: B.flip, settle: B.settle, z: now.top < was.top - 0.5 ? 2 : 0 };
      }
      const ghost = morph(ctx, { el, was, now, old, k, t, hostRect: geo.hosts.get(el.parentElement) });
      if (opts.swipe && key === `i:${opts.swipe.id}`) {
        // Let go past 80 px: the row goes on from where the finger left it back into place, now read; its words fade where they were.
        play(ctx, el, [{ transform: `translateX(${opts.swipe.dx}px)` }, { transform: 'none' }], [0, 0.20]);
        const h = swipeHint(el);
        h.classList.add('is-armed');
        play(ctx, h, [{ transform: `translateX(${-opts.swipe.dx}px)`, opacity: 1 }, { transform: 'none', opacity: 0 }], [0, 0.20]);
        ctx.clean(() => h.remove());
      }
      if (key === self && name === 'answer') { const check = el.querySelector('.d-check'); play(ctx, check, [{ opacity: 0, transform: 'scale(.55)' }, { opacity: 1, transform: 'none' }], [0.12, 0.18]); }
      if (lead?.mine) fillReceipt(ctx, el, ghost, key.slice(2), B.receipt);
    }
    // Leaving.
    const sources = new Set();
    for (const [key] of entering) { const from = key.startsWith('i:') && wasFolded.get(key.slice(2)); if (from) sources.add(from); }
    for (const [key, node] of removed) {
      const was = before.get(key);
      if (!was) continue;
      const g = ghostOf(node, was, k, was.host, 0, geo.hosts.get(was.host));
      ctx.clean(() => g.remove());
      g.style.transformOrigin = 'top center';
      const id = key.slice(2), item = key.startsWith('i:');
      const into = item && folded.get(id), target = into && after.get(into);
      const merged = item && (s.state.historical || []).find(h => h.id === id && h.status === 'merged');
      const mergedInto = merged && after.get(`i:${merged.merged_into}`);
      const chip = name === 'snooze' && key === self && geo.chip;
      if (chip) play(ctx, g, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translate(${(chip.left - was.left) / k}px, ${(chip.top - was.top) / k}px) scale(.2)` }], B.fly, { easing: EASE_IN_OUT });
      else if (opts.swipe && key === `i:${opts.swipe.id}`) play(ctx, g, [{ transform: `translateX(${opts.swipe.dx}px)`, opacity: 1 }, { transform: `translateX(${-was.width / k}px)`, opacity: 0 }], [0, 0.20], { easing: EASE_IN });
      else if (target) play(ctx, g, [{ opacity: 1, transform: 'none' }, { opacity: 0, offset: 0.85 }, { opacity: 0, transform: `translateY(${(target.top - was.top) / k}px) scale(.96, .5)` }], B.exit, { easing: EASE_IN_OUT });
      else if (mergedInto) play(ctx, g, [{ opacity: 1, transform: 'none' }, { opacity: 0, offset: 0.8 }, { opacity: 0, transform: `translateY(${(mergedInto.top - was.top) / k}px) scale(.97)` }], B.exit, { easing: EASE_IN_OUT });
      else if (sources.has(key)) play(ctx, g, [{ opacity: 1 }, { opacity: 0 }], [B.enter[0], B.enter[1] * 0.6], { easing: 'linear' });
      else play(ctx, g, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-4px) scale(.985)' }], B.exit, { easing: EASE_IN });
    }
    // Arriving, 40 ms apart: out of the fold row they were counted in, otherwise revealed from the top edge down.
    let n = 0;
    for (const [key, now] of entering) {
      const from = key.startsWith('i:') && wasFolded.get(key.slice(2));
      const src = from && (after.get(from) || before.get(from));
      const at = [B.enter[0] + Math.min(n, STAGGER_MAX) * STAGGER, B.enter[1]];
      n += 1;
      if (src) slideFrom(ctx, now.el, now, src, k, at); else reveal(ctx, now.el, at);
    }
  }
  /** A receipt the Agent has now read: the hollow check fills, its line says 已收到 (0–0.30 s, before anything moves). */
  function fillReceipt(ctx, el, ghost, id, at) {
    const rec = answersFor(id)[0];
    if (!rec) return;
    const { status, at: when } = responseStatus(rec, s.frames, s.cursor);
    if (status !== 'acknowledged') return;
    const fill = receipt => {
      const check = receipt?.querySelector('.d-check');
      if (!check) return;
      receipt.classList.add('is-filling');
      const dot = document.createElement('i');
      dot.className = 'd-check-fill';
      dot.textContent = '✓';
      check.append(dot);
      play(ctx, dot, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], at);
      ctx.clean(() => { dot.remove(); receipt.classList.remove('is-filling'); });
    };
    const live = el.querySelector('.d-receipt.is-acknowledged');
    if (live) { fill(live); return; }
    const old = ghost?.querySelector('.d-receipt');
    if (!old) return;
    const small = old.querySelector('small');
    if (small) small.textContent = receivedWords(rec, when);
    fill(old);
  }
  // The new-question glow plays once per frame and item, timed by the beat (--glow-delay).
  function markNew() {
    for (const card of scroll.querySelectorAll('.d-card[data-new]')) {
      const key = `${s.index}:${card.dataset.id}`;
      if (pulsed.has(key)) continue;
      pulsed.add(key);
      card.classList.add('is-pulse');
    }
  }
  // Keep keyboard focus and unsent replies across re-renders.
  const FOCUS_ATTRS = ['data-rs-act', 'data-rs-open', 'data-rs-key', 'data-rs-undo', 'data-rs-send', 'data-rs-text', 'data-ack', 'data-d', 'data-open', 'data-undo-key'];
  function focusMark() {
    const el = document.activeElement;
    if (!el || !scroll.contains(el)) return null;
    const leaf = el.closest('[data-key]');
    const attrs = FOCUS_ATTRS.filter(a => el.hasAttribute(a)).map(a => `[${a}="${CSS.escape(el.getAttribute(a))}"]`).join('');
    return { key: leaf?.dataset.key, attrs, self: el === leaf };
  }
  function restoreFocus(mark) {
    if (!mark || scroll.contains(document.activeElement)) return;
    const leaf = mark.key && scroll.querySelector(`[data-key="${CSS.escape(mark.key)}"]`);
    const target = (mark.attrs && !mark.self && (leaf || scroll).querySelector(mark.attrs)) || leaf?.querySelector('[data-rs-undo], button') || leaf;
    target?.focus({ preventScroll: true });
  }
  function restoreDrafts() {
    for (const box of host.querySelectorAll('[data-rs-text]')) { const v = textDrafts.get(box.dataset.rsText); if (v && !box.value) box.value = v; }
  }

  // ---------- render ----------
  let headSig = '';
  /** name: which beat to play — none (first paint), turn, answer, undo, snooze, local. */
  function render(name = 'local', opts = {}) {
    if (disposed) return;
    const view = buildView(compose());
    if (name === 'none' || !(same($('.d-cards'), view.cards) && same($('.d-rows'), view.rows) && same($('.d-known'), view.tail) && headSig === view.head.sig)) update(view, name, opts);
    renderRail();
    renderDetail(name === 'none');
  }
  const setHTML = (el, html) => { if (el.__html === html) return false; el.__html = html; el.innerHTML = html; return true; };
  function renderHead(h) {
    headSig = h.sig;
    $('.d-status-time').textContent = clock(h.at);
    $('.d-date').textContent = `${dayLong.format(h.at)} ${weekday.format(h.at)} · ${clock(h.at)}`;
    const headline = $('.d-headline');
    const before = headline.__html === undefined ? null : headline.querySelector('.d-count')?.textContent ?? null;
    let rollTo = null;
    if (setHTML(headline, h.headline)) { const after = headline.querySelector('.d-count')?.textContent ?? null; if (before != null && after != null && before !== after) rollTo = { before, after }; }
    setHTML($('.d-since'), h.since); // nothing to sort yet: no surface switch either
    const sn = $('.d-snoozed');
    sn.hidden = !h.sz.length;
    setHTML(sn, h.sz.length ? `◷ ${h.sz.length} 件 · ${h.first}` : '');
    sn.setAttribute('aria-label', h.sz.length ? `稍后提醒 ${h.sz.length} 件，最早 ${h.first}` : '');
    const sig = $('.d-signal');
    sig.hidden = !h.signalText;
    if (h.signalText) sig.textContent = h.signalText;
    setHTML($('.d-fold-text'), h.fold);
    return { roll: rollTo, segs: h.segs, inputs: h.inputs };
  }
  /** The head's motion: the count rolls at the beat's hero time; on a landing the band rescales and the grain draws in. */
  function headEffects(ctx, fx, B, name, geo) {
    if (fx.roll && B) roll(ctx, $('.d-headline'), fx.roll.before, fx.roll.after, B.hero);
    band(ctx, bandEl, fx.segs, geo.band, name === 'turn' && B ? B.band : null);
    if (name === 'turn' && B) gather(ctx, $('.d-fold-tex'), fx.inputs, B.tex, geo.tex);
  }
  function renderRail() {
    $('.d-rail-date').textContent = `${stamp(s.frame.at)} · ${s.index + 1}/${s.frames.length}`;
    $('.d-rail-title').textContent = s.frame.title;
    $('.d-rail-narrative').textContent = s.frame.narrative || '';
    const signal = s.frame.signal;
    $('.d-rail-signal').textContent = signal ? (signal.type === 'review' ? `调用原因：${signal.reason}，窗口内 0 条事件` : `调用原因：${signal.reason || '收到新输入'} · ${signal.received} 条`) : '初始状态';
    const play = $('.d-play');
    play.setAttribute('aria-label', s.playing ? '暂停' : '播放');
    play.firstElementChild.textContent = s.playing ? '❚❚' : '▶';
    play.classList.toggle('is-on', Boolean(s.playing));
    renderTrack();
    host.querySelectorAll('[data-surface]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.surface === surface)));
    $('.d-surface-policy').textContent = surfaces.find(x => x.id === surface).policy;
    const baseFrame = s.frames[s.baseIndex];
    $('.d-base-btn').innerHTML = `${s.baseIndex === s.index - 1 ? '上一轮 · ' : ''}${stamp(baseFrame.at)}<span aria-hidden="true">▾</span>`;
    if (!$('.d-base-menu').hidden) renderBaseMenu();
  }
  function renderTrack() {
    const n = s.frames.length - 1, pos = i => `${(i / Math.max(1, n)) * 100}%`;
    if (!track.__built) {
      let lastDay = '';
      $('.d-track-ticks').innerHTML = s.frames.map((f, i) => { const d = formatDate(f.at); const first = d !== lastDay; lastDay = d; return `<i class="${first ? 'is-day' : ''}" style="left:${pos(i)}"></i>`; }).join('');
      track.__built = true;
    }
    [...$('.d-track-ticks').children].forEach((tick, i) => tick.classList.toggle('is-past', i <= s.index));
    $('.d-track-thumb').style.left = pos(s.index);
    track.setAttribute('aria-valuemin', '1'); track.setAttribute('aria-valuemax', String(n + 1)); track.setAttribute('aria-valuenow', String(s.index + 1));
    track.setAttribute('aria-valuetext', `${stamp(s.frame.at)} ${s.frame.title}`);
  }
  function renderBaseMenu() {
    $('.d-base-menu').innerHTML = s.frames.slice(0, s.index + 1).map((f, i) => ({ f, i })).reverse().map(({ f, i }) => `<button role="option" aria-selected="${i === s.baseIndex}" data-base="${i}"><span>${stamp(f.at)}${i === s.index - 1 ? '<em>上一轮</em>' : i === s.index ? '<em>此刻</em>' : ''}</span><small>${esc(f.title)}</small></button>`).join('');
  }
  function toggleBaseMenu(show = $('.d-base-menu').hidden) {
    const menu = $('.d-base-menu'); menu.hidden = !show; $('.d-base-btn').setAttribute('aria-expanded', String(show));
    if (show) { renderBaseMenu(); menu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }
  }


  // The detail grows out of the card or row you tapped and shrinks back into it (home-motion.md 3.5, 4.3).
  const detail = { id: null, origin: null, ctx: null, rig: null, pushed: false, instant: false, dragQ: null, ignorePop: 0 };
  function fillDetail(parts) {
    let changed = false;
    for (const [el, html] of [[panelBar, parts.bar], [panelBody, parts.body], [panelActions, parts.actions]]) changed = setHTML(el, html) || changed;
    restoreDrafts();
    return changed;
  }
  function renderDetail(first = false) {
    const id = s.selectedId, item = id && getItem(s.state, id);
    if (!item) { if (detail.id) closeDetail(); return; }
    const parts = detailParts(item);
    if (detail.id === item.id) { const top = panelBody.scrollTop; fillDetail(parts); panelBody.scrollTop = top; return; }
    const switching = Boolean(detail.id);
    detail.id = item.id;
    fillDetail(parts);
    panelBody.scrollTop = 0;
    if (switching) {
      // From one detail to another (a child, a link in the log): the words change in place.
      if (!reduced()) for (const el of [panelBar, panelBody, panelActions]) el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 180, easing: EASE });
      panelBar.querySelector('[data-d="back"]')?.focus({ preventScroll: true });
      return;
    }
    openPanel(first ? null : originFor(item.id));
  }
  const originFor = id => (detail.origin?.isConnected && detail.origin.dataset.id === id ? detail.origin : homeEl(id)) || null;
  /** Everything the grow and the shrink move: two boxes (card look, paper), the card's own words, the travelling headline, the rest. */
  function makeRig(origin) {
    const k = scale() || 1;
    panel.classList.add('is-growing');
    const P = panel.getBoundingClientRect(), O = origin.getBoundingClientRect();
    const W = P.width / k, H = P.height / k, ow = O.width / k, oh = O.height / k, sc = (ow + 8) / ow;
    const popped = { x: (O.left - P.left) / k - (ow * (sc - 1)) / 2, y: (O.top - P.top) / k - (oh * (sc - 1)) / 2, w: ow * sc, h: oh * sc };
    const full = { x: 0, y: 0, w: W, h: H };
    const base = Math.max(W, popped.w);
    // Both boxes always share one rect; the card's look lies on top of the paper and fades to it, so the frame is never see-through.
    const card = makeBox(panel, lookOf(origin) || { key: 'card', bg: 'var(--card)', r: 16 }, base);
    const paper = makeBox(panel, lookOf(panel), base);
    const face = origin.cloneNode(true);
    for (const a of ['data-key', 'data-id', 'tabindex', 'id']) face.removeAttribute(a);
    face.querySelectorAll('[data-key], [id]').forEach(x => { x.removeAttribute('data-key'); x.removeAttribute('id'); });
    face.classList.remove('is-focus', 'is-pressing', 'is-lifted', 'is-pulse');
    face.classList.add('d-ghost', 'is-face', 'd-face');
    face.setAttribute('inert', '');
    Object.assign(face.style, { position: 'absolute', left: `${(O.left - P.left) / k}px`, top: `${(O.top - P.top) / k}px`, width: `${ow}px`, height: `${oh}px`, margin: '0', transform: `scale(${sc})`, transformOrigin: '50% 50%', opacity: '0' });
    panel.insertBefore(face, panelBar);
    // The headline travels from the card to the top of the detail (21 → 22 px) when the words are the same.
    const src = origin.querySelector('[data-part="prompt"]') || origin.querySelector('[data-part="title"]');
    const h2 = panelBody.querySelector('h2');
    let anchor = null;
    if (src && h2 && panelBody.scrollTop <= 0 && src.textContent.replace(/\s+/g, '') === h2.textContent.replace(/\s+/g, '')) {
      const Q = src.getBoundingClientRect(), T = h2.getBoundingClientRect();
      const cx = O.left + O.width / 2, cy = O.top + O.height / 2;
      const qx = cx + (Q.left - cx) * sc, qy = cy + (Q.top - cy) * sc;
      const f = (parseFloat(getComputedStyle(src).fontSize) * sc) / parseFloat(getComputedStyle(h2).fontSize);
      anchor = { el: h2, inFace: face.querySelector(`[data-part="${src.dataset.part}"]`), from: `translate(${((qx - T.left) / k).toFixed(1)}px, ${((qy - T.top) / k).toFixed(1)}px) scale(${f.toFixed(4)})` };
    }
    const content = [panelBar, ...[...panelBody.children].filter(x => x !== anchor?.el)];
    return { origin, popped, full, sc, paper, card, face, anchor, content,
      remove() { paper.remove(); card.remove(); face.remove(); panel.classList.remove('is-growing'); } };
  }
  function openPanel(origin) {
    settle(detail.ctx);
    panel.hidden = false;
    panel.classList.remove('is-leaving');
    pushDetail();
    focusBack();
    if (!origin || reduced() || document.hidden) return;
    const ctx = detail.ctx = newCtx(), R = detail.rig = makeRig(origin);
    dim(origin, 0);
    const t1 = GROW.frame[0] + GROW.frame[1];
    // 0–0.12 the card steps out 8 px (overshoot 3.7 %), still itself.
    play(ctx, origin, popKeys(1, R.sc), GROW.pop, { easing: 'linear' });
    // 0.12–0.36 its frame grows to the whole screen; the card's look gives way to paper as it gets there.
    R.card.animate(ctx, R.popped, R.full, GROW.frame);
    R.paper.animate(ctx, R.popped, R.full, GROW.frame);
    const a = GROW.frame[0] / t1;
    play(ctx, R.card.el, [{ opacity: 0 }, { opacity: 0, offset: a - 0.001 }, { opacity: 1, offset: a }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], [0, t1], { easing: 'linear' });
    play(ctx, R.paper.el, [{ opacity: 0 }, { opacity: 0, offset: a - 0.001 }, { opacity: 1, offset: a }, { opacity: 1 }], [0, t1], { easing: 'linear' });
    // The card's words stay on its place and leave as the frame grows; the headline travels to the top.
    const fe = GROW.face[0] + GROW.face[1];
    play(ctx, R.face, [{ opacity: 0 }, { opacity: 0, offset: GROW.face[0] / fe - 0.001 }, { opacity: 1, offset: GROW.face[0] / fe }, { opacity: 0 }], [0, fe], { easing: 'linear' });
    if (R.anchor) {
      R.anchor.inFace?.style.setProperty('visibility', 'hidden'); // it is the one travelling
      R.anchor.el.style.transformOrigin = '0 0';
      ctx.clean(() => { R.anchor.el.style.transformOrigin = ''; });
      play(ctx, R.anchor.el, [{ transform: R.anchor.from }, { transform: 'none' }], GROW.anchor);
      stepAt(ctx, R.anchor.el, GROW.anchor[0], true);
    }
    // 0.30–0.48 the detail's sections come up 6 px below the headline; the answer area rises from the bottom.
    for (const el of R.content) play(ctx, el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], GROW.content);
    play(ctx, panelActions, [{ opacity: 0, transform: 'translateY(100%)' }, { opacity: 1, transform: 'none' }], GROW.content);
    play(ctx, panelBg, [{ opacity: 0 }, { opacity: 1 }], GROW.content, { easing: 'linear' });
    arm(ctx, () => { R.remove(); if (detail.rig === R) detail.rig = null; });
  }
  const focusBack = () => panelBar.querySelector('[data-d="back"]')?.focus({ preventScroll: true });
  /** Dim the rest of the list to 70 % (an origin stays lit); undim after `delay` seconds. */
  function dim(origin, delay = 0) {
    if (origin) { scroll.querySelectorAll('.is-focus').forEach(x => x !== origin && x.classList.remove('is-focus')); origin.classList.add('is-focus'); }
    scroll.style.setProperty('--undim-delay', `${delay}s`);
    scroll.classList.toggle('is-dim', Boolean(origin));
  }
  function undim(delay) {
    scroll.style.setProperty('--undim-delay', `${delay}s`);
    scroll.classList.remove('is-dim');
    scroll.querySelectorAll('.is-focus').forEach(x => x.classList.remove('is-focus'));
  }
  function closeDetail() {
    const id = detail.id;
    detail.id = null;
    detailStack.length = 0;
    popDetailHistory();
    const instant = detail.instant || reduced() || document.hidden || panel.hidden;
    detail.instant = false;
    const q = detail.dragQ;
    detail.dragQ = null;
    if (q == null) settle(detail.ctx);
    const origin = originFor(id);
    detail.origin = null;
    const done = () => {
      if (detail.id) return; // reopened meanwhile
      panel.hidden = true;
      panel.classList.remove('is-leaving', 'is-growing');
      for (const el of [panelBar, panelBody, panelActions]) { el.__html = undefined; el.innerHTML = ''; el.style.opacity = ''; el.style.transform = ''; }
      panelBg.style.opacity = '';
      if (!scroll.classList.contains('is-dim') || !peekState) undim(0);
      restoring = true; origin?.focus({ preventScroll: true }); restoring = false; // back where you were, without its summary
      releasePlay();
    };
    if (instant || !origin) {
      settle(detail.ctx);
      if (detail.rig) { detail.rig.remove(); detail.rig = null; }
      if (instant) { undim(0); done(); return; }
      panel.classList.add('is-leaving');
      const ctx = detail.ctx = newCtx();
      play(ctx, panel, [{ opacity: 1 }, { opacity: 0 }], [0, 0.2], { easing: EASE_IN });
      undim(0.1);
      arm(ctx, () => { panel.style.opacity = ''; done(); });
      return;
    }
    panel.classList.add('is-leaving');
    const ctx = detail.ctx = newCtx();
    const R = detail.rig || makeRig(origin);
    detail.rig = R;
    if (!origin.classList.contains('is-focus')) dim(origin, 0);
    // From a drag the frame goes on from where the finger left it, in the time that is left.
    const f = q == null ? 1 : Math.max(0.45, q);
    const sp = ([a, d]) => [a * f, d * f];
    const from = q == null ? R.full : lerpRect(R.popped, R.full, q);
    const cur = el => Number(el.style.opacity || (q == null ? 1 : 0));
    for (const el of [...R.content, ...(R.anchor ? [R.anchor.el] : [])]) play(ctx, el, [{ opacity: q == null ? 1 : cur(el), transform: 'none' }, { opacity: 0, transform: 'none' }], sp(SHRINK.content), { easing: 'linear' });
    play(ctx, panelActions, [{ opacity: q == null ? 1 : cur(panelActions) }, { opacity: 0 }], sp(SHRINK.content), { easing: 'linear' });
    play(ctx, panelBg, [{ opacity: q == null ? 1 : cur(panelBg) }, { opacity: 0 }], sp(SHRINK.content), { easing: 'linear' });
    R.card.animate(ctx, from, R.popped, sp(SHRINK.frame), EASE_IN_OUT);
    R.paper.animate(ctx, from, R.popped, sp(SHRINK.frame), EASE_IN_OUT);
    R.paper.el.style.opacity = '1';
    play(ctx, R.card.el, [{ opacity: q == null ? 0 : cur(R.card.el) }, { opacity: 1 }], sp([SHRINK.frame[0], SHRINK.frame[1] * 0.4]), { easing: 'linear' });
    play(ctx, R.face, [{ opacity: q == null ? 0 : cur(R.face) }, { opacity: 1 }], sp(SHRINK.face), { easing: 'linear' });
    const landed = (SHRINK.pop[0]) * f;
    stepAt(ctx, panel, landed, false);
    // 0.30–0.40 the card steps back in; the rest of the list comes back to full.
    play(ctx, origin, [{ transform: `scale(${R.sc})` }, { transform: 'none' }], [landed, SHRINK.pop[1]], { easing: EASE_IN_OUT });
    undim(landed);
    arm(ctx, () => { R.remove(); if (detail.rig === R) detail.rig = null; done(); });
  }
  // Pull the detail down when it is scrolled to the top: the frame follows the finger back toward its card.
  function dragState(q) {
    const R = detail.rig;
    if (!R) return;
    const r = lerpRect(R.popped, R.full, q);
    R.card.set(r); R.paper.set(r);
    const c = clamp((q - 0.55) / 0.45);
    for (const el of [...R.content, panelActions, panelBg, ...(R.anchor ? [R.anchor.el] : [])]) el.style.opacity = c.toFixed(3);
    R.paper.el.style.opacity = '1';
    R.card.el.style.opacity = clamp((0.9 - q) / 0.4).toFixed(3);
    R.face.style.opacity = clamp((0.4 - q) / 0.4).toFixed(3);
  }
  function startDrag() {
    const origin = originFor(detail.id);
    if (!origin || reduced()) return false;
    settle(detail.ctx);
    detail.rig = makeRig(origin);
    if (!origin.classList.contains('is-focus')) dim(origin, 0);
    origin.style.transform = `scale(${detail.rig.sc})`;
    dragState(1);
    return true;
  }
  function endDrag(q, close) {
    const R = detail.rig;
    if (!R) return;
    R.origin.style.transform = '';
    if (close) { detail.dragQ = q; model.select(null); return; }
    // Not far enough: back to the whole screen in 0.20 s.
    const ctx = detail.ctx = newCtx();
    const now = lerpRect(R.popped, R.full, q);
    R.card.animate(ctx, now, R.full, [0, 0.2]); R.paper.animate(ctx, now, R.full, [0, 0.2]);
    for (const el of [...R.content, panelActions, panelBg, R.card.el, R.face, ...(R.anchor ? [R.anchor.el] : [])]) {
      const to = el === R.card.el || el === R.face ? 0 : 1;
      play(ctx, el, [{ opacity: Number(el.style.opacity || 0) }, { opacity: to }], [0, 0.2], { easing: 'linear' });
    }
    play(ctx, R.origin, [{ transform: `scale(${R.sc})` }, { transform: `scale(${R.sc})` }], [0, 0.2]);
    arm(ctx, () => {
      R.remove(); if (detail.rig === R) detail.rig = null;
      for (const el of [...R.content, panelActions, panelBg, ...(R.anchor ? [R.anchor.el] : [])]) el.style.opacity = '';
    });
  }
  let pull = null;
  const touchY = e => e.touches[0]?.clientY ?? 0, touchX = e => e.touches[0]?.clientX ?? 0;
  panel.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || panel.hidden || panel.classList.contains('is-leaving') || e.target.closest('textarea, input, .d-keypad')) { pull = null; return; }
    pull = { x: touchX(e), y: touchY(e), top: panelBody.scrollTop <= 0 || !panelBody.contains(e.target), on: false, q: 1, samples: [] };
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (!pull) return;
    const dx = touchX(e) - pull.x, dy = touchY(e) - pull.y;
    if (!pull.on) {
      // Down from the top is ours from the first pixel (so Safari does not start its own bounce); anything else scrolls.
      if (!pull.top || dy < 0 || Math.abs(dx) > Math.abs(dy)) { if (Math.abs(dx) > 8 || dy < -2) pull = null; return; }
      if (e.cancelable) e.preventDefault();
      if (dy < 8) return;
      if (!startDrag()) { pull = null; return; }
      pull.on = true;
    }
    if (e.cancelable) e.preventDefault();
    const range = panel.getBoundingClientRect().height * 0.6;
    pull.q = 1 - clamp((dy - 8) / range);
    pull.dy = dy;
    pull.samples.push([performance.now(), dy]);
    if (pull.samples.length > 6) pull.samples.shift();
    dragState(pull.q);
  }, { passive: false });
  const endPull = () => {
    const p = pull;
    pull = null;
    if (!p?.on) return;
    const [t0, y0] = p.samples[0] || [0, 0], [t1, y1] = p.samples.at(-1) || [1, 0];
    const v = (y1 - y0) / Math.max(1, t1 - t0);
    const h = panel.getBoundingClientRect().height;
    endDrag(p.q, p.dy > h / 4 || v > 0.5);
  };
  panel.addEventListener('touchend', endPull);
  panel.addEventListener('touchcancel', endPull);
  // The left-edge swipe is Safari's back: while a detail is open it means “close”, and Safari draws that motion itself.
  function pushDetail() {
    if (embedded || detail.pushed) return;
    try { history.pushState({ foldDetail: true }, '', location.href); detail.pushed = true; } catch { /* a sandboxed page */ }
  }
  function popDetailHistory() {
    if (!detail.pushed) return;
    detail.pushed = false;
    detail.landed = location.href;
    detail.ignorePop += 1;
    history.back();
  }
  const onPop = () => {
    if (detail.ignorePop) { detail.ignorePop -= 1; if (detail.landed) history.replaceState(null, '', detail.landed); return; }
    if (!detail.pushed) return;
    detail.pushed = false;
    detail.instant = true;
    model.select(null);
  };
  addEventListener('popstate', onPop);

  // Hovering and opening hold the replay (ix.mjs); 0.4 s after both are gone it plays on.
  let held = false, resumeTimer = null;
  function holdPlay() { clearTimeout(resumeTimer); if (s.playing) { held = true; model.pause(); } }
  function releasePlay() {
    clearTimeout(resumeTimer);
    if (!held) return;
    resumeTimer = setTimeout(() => { if (held && !peekState && !detail.id && !s.playing && !disposed) { held = false; model.togglePlay(); } }, IX.resume * 1000);
  }

  // ---------- the summary card: a long press (or keyboard focus) on a row, as hover is on a desk ----------
  let peekState = null, peekOut = null;
  function roundPeekHTML() {
    const labels = { used: '采用', duplicate: '重复', noise: '噪音', deferred: '暂缓' };
    const counts = s.frame.events.reduce((m, e) => (m[e.disposition] = (m[e.disposition] || 0) + 1, m), {});
    const blank = s.state.root.budget - s.state.root.used, gone = (s.state.historical || []).length;
    return `<div class="ix-k">第 ${s.index} 轮 · ${esc(stamp(s.frame.at))}</div><div class="ix-q">本轮 ${s.frame.events.length} 条输入</div>
      <div class="ix-d">${Object.entries(counts).map(([k, n]) => `${labels[k] || k} ${n}`).join(' · ') || '没有新输入'}</div>
      <div class="ix-d">现在 ${s.state.root.items.length} 件 · 已分 ${s.state.root.used} / 64 份 · 空余 ${Math.max(0, blank)} 份${gone ? ` · 撤下或合并 ${gone}` : ''}</div>`;
  }
  function showPeek(id, row, via) {
    if (!row || (peekState?.id === id && peekState.row === row)) return;
    hidePeek(true);
    settle(peekOut); peekOut = null;
    const facts = id !== 'fold' && s.state.root.items.some(x => x.id === id) ? itemFacts(s.index, id) : null;
    const item = id !== 'fold' && getItem(s.state, id);
    peekEl.innerHTML = id === 'fold' ? roundPeekHTML() : facts ? peekHTML(facts) : `<div class="ix-q">${esc(item?.title || id)}</div><div class="ix-d">${item ? `${item.share} 份 · ${esc(kindLabel[item.kind] || '')}` : ''}</div>`;
    peekEl.dataset.id = id;
    peekEl.hidden = false;
    placePeek(row);
    const k = scale() || 1, w = row.getBoundingClientRect().width / k, sc = (w + 8) / w;
    const ctx = newCtx();
    peekState = { id, row, via, ctx, sc };
    holdPlay();
    dim(row, 0);
    if (row.matches('.d-line')) row.classList.add('is-lifted');
    if (reduced()) return;
    play(ctx, row, popKeys(1, sc), [0, PRESS.peekIn], { easing: 'linear' });
    play(ctx, peekEl, [{ opacity: 0, transform: 'translateY(-4px) scaleY(.94)' }, { opacity: 1, transform: 'none' }], [0, PRESS.peekIn]);
  }
  /** Below the row (above it when there is no room before the 累计 bar), never under the bar. */
  function placePeek(row) {
    const k = scale() || 1, scr = screenEl.getBoundingClientRect(), r = row.getBoundingClientRect();
    peekEl.style.width = `${Math.min(r.width / k, 340)}px`;
    const h = peekEl.offsetHeight, w = peekEl.offsetWidth;
    const fold = $('.d-fold').getBoundingClientRect();
    const view = ownScroll() ? scroll.getBoundingClientRect() : { top: Math.max(0, $('.d-rail').getBoundingClientRect().bottom), bottom: innerHeight };
    const floor = Math.min(view.bottom, fold.height && row !== $('.d-fold') ? fold.top : view.bottom) - 8 * k;
    let y = r.bottom + 8 * k;
    if (y + h * k > floor) y = r.top - (h + 8) * k;
    if (y < view.top + 4 * k) y = r.bottom + 8 * k;
    peekEl.style.left = `${((r.left - scr.left) / k + (r.width / k - w) / 2).toFixed(1)}px`;
    peekEl.style.top = `${((y - scr.top) / k).toFixed(1)}px`;
  }
  function hidePeek(instant = false) {
    const p = peekState;
    if (!p) return;
    peekState = null;
    settle(p.ctx);
    p.row.classList.remove('is-lifted');
    const keepLit = detail.id && detail.origin === p.row;
    if (!keepLit && !detail.id) undim(instant ? 0 : PRESS.peekOut);
    if (instant || reduced()) { peekEl.hidden = true; releasePlay(); return; }
    // The card fades in 0.12 s, the row steps back in 0.10 s, the rest comes back to full.
    const ctx = peekOut = newCtx();
    play(ctx, peekEl, [{ opacity: 1 }, { opacity: 0 }], [0, PRESS.peekOut], { easing: 'linear' });
    if (!keepLit) play(ctx, p.row, [{ transform: `scale(${p.sc})` }, { transform: 'none' }], [0.02, PRESS.drop]);
    arm(ctx, () => { if (!peekState) peekEl.hidden = true; });
    releasePlay();
  }

  // ---------- sheets ----------
  const sheet = $('.d-sheet'), backdrop = $('.d-sheet-backdrop');
  /** End any open/close motion on the sheet now; a closing sheet hides at once. */
  const settleSheet = () => { for (const el of [sheet, backdrop]) for (const a of el.getAnimations()) a.cancel(); };
  function openSheet(html, label = '操作') {
    settleSheet();
    hidePeek(true);
    if (sheet.hidden) sheetReturn = document.activeElement;
    sheet.setAttribute('aria-label', label);
    sheet.innerHTML = `<div class="d-sheet-grip" aria-hidden="true"></div>${html}`;
    const wasHidden = sheet.hidden;
    sheet.hidden = false; backdrop.hidden = false;
    sheet.style.transform = ''; backdrop.style.opacity = '';
    if (wasHidden && !reduced()) {
      sheet.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 300, easing: EASE });
      backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
    }
    restoreDrafts();
    (sheet.querySelector('textarea, [data-rs-keypad], .d-sheet-options button, button:not(.d-sheet-grip)'))?.focus({ preventScroll: true });
  }
  function closeSheet({ refocus = true, from = 0 } = {}) {
    if (sheet.hidden || sheet.classList.contains('is-leaving')) return;
    const done = () => { sheet.classList.remove('is-leaving'); sheet.hidden = true; backdrop.hidden = true; sheet.innerHTML = ''; sheet.style.transform = ''; backdrop.style.opacity = ''; settleSheet(); };
    if (reduced()) done();
    else {
      sheet.classList.add('is-leaving');
      const left = 1 - from / Math.max(1, sheet.offsetHeight);
      const a = sheet.animate([{ transform: `translateY(${from}px)` }, { transform: 'translateY(100%)' }], { duration: Math.max(120, 220 * left), easing: EASE_IN, fill: 'forwards' });
      a.onfinish = done; a.oncancel = done;
      setTimeout(() => { if (sheet.classList.contains('is-leaving') && pinned == null) done(); }, 400);
      backdrop.animate([{ opacity: Number(backdrop.style.opacity || 1) }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
    }
    if (refocus && sheetReturn?.isConnected) { restoring = true; sheetReturn.focus({ preventScroll: true }); restoring = false; }
    sheetReturn = null;
  }
  // Pull the sheet down by its grip, or anywhere once its content is at the top: it follows; far or fast enough closes it.
  let sheetPull = null;
  sheet.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || sheet.classList.contains('is-leaving') || e.target.closest('textarea, input, .d-keypad')) { sheetPull = null; return; }
    sheetPull = { y: touchY(e), x: touchX(e), top: sheet.scrollTop <= 0 || Boolean(e.target.closest('.d-sheet-grip')), on: false, dy: 0, samples: [] };
  }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    const p = sheetPull;
    if (!p) return;
    const dy = touchY(e) - p.y, dx = touchX(e) - p.x;
    if (!p.on) {
      if (!p.top || dy < 0 || Math.abs(dx) > Math.abs(dy)) { if (Math.abs(dx) > 8 || dy < -2) sheetPull = null; return; }
      if (e.cancelable) e.preventDefault();
      if (dy < 6) return;
      p.on = true;
      settleSheet();
    }
    if (e.cancelable) e.preventDefault();
    p.dy = Math.max(0, dy - 6);
    p.samples.push([performance.now(), dy]);
    if (p.samples.length > 6) p.samples.shift();
    sheet.style.transform = `translateY(${p.dy}px)`;
    backdrop.style.opacity = String(1 - clamp(p.dy / sheet.offsetHeight));
  }, { passive: false });
  const endSheetPull = () => {
    const p = sheetPull;
    sheetPull = null;
    if (!p?.on) return;
    const [t0, y0] = p.samples[0] || [0, 0], [t1, y1] = p.samples.at(-1) || [1, 0];
    const v = (y1 - y0) / Math.max(1, t1 - t0);
    if (p.dy > sheet.offsetHeight / 4 || v > 0.5) { closeSheet({ from: p.dy }); return; }
    const a = sheet.animate([{ transform: `translateY(${p.dy}px)` }, { transform: 'none' }], { duration: 200, easing: EASE });
    sheet.style.transform = '';
    backdrop.animate([{ opacity: Number(backdrop.style.opacity || 1) }, { opacity: 1 }], { duration: 200 });
    backdrop.style.opacity = '';
    a.onfinish = null;
  };
  sheet.addEventListener('touchend', endSheetPull);
  sheet.addEventListener('touchcancel', endSheetPull);
  const findAny = id => getItem(s.state, id);
  const askAction = key => { const [id, aid] = key.split(':'); const ask = normalizeAsk(currentAsk(s, id)); return { item: findAny(id), ask, action: ask?.actions.find(a => a.id === aid) }; };
  function keypadSheet(key) { const { item, action } = askAction(key); openSheet(`<h3>${esc(action.label)}</h3><p class="d-small">${esc(item.title)}</p>${keypadHTML(action, { key, value: drafts.get(key) ?? action.input.prefill, classes: RS })}`, action.label); }
  function composeSheet(key) { const { ask, action } = askAction(key); openSheet(`<h3>${esc(action.label)}</h3><p class="d-small">${esc(ask.prompt)}</p>${composerHTML({ ...action, input: { placeholder: '写一句，Agent 下一轮整理时带上', ...action.input } }, { key, classes: RS })}`, action.label); }
  function scheduleSheet(key) { const { ask, action } = askAction(key); openSheet(`<h3>${esc(action.label)}</h3><p class="d-small">${esc(ask.prompt)}</p>${scheduleHTML(action, { key, now: s.cursor, classes: RS })}`, action.label); }
  function snoozeSheet(item) { openSheet(`<h3>什么时候再提醒？</h3><p class="d-small">「${esc(item.title)}」<br>稍后提醒不是已阅，也不改原截止时间。到点后按那时的情况重看。</p>${deferHTML({ target: item.id, now: s.cursor, classes: RS })}`, '稍后提醒'); }
  function actionsSheet(item) {
    const ask = currentAsk(s, item.id);
    openSheet(`<p class="d-sheet-kicker">${dot(colorFor(item, s.state))}${esc(item.title)}</p><h3>${esc(ask?.prompt || item.title)}</h3><p class="d-small">${esc(item.summary)}</p>${ask ? answerHTML(item, ask, { inDetail: true }) : ''}<button type="button" class="d-link d-sheet-detail" data-open="${esc(item.id)}">看依据与来龙去脉 ›</button>`, ask?.prompt || item.title);
  }
  function foldSheet() {
    const labels = { used: '采用', duplicate: '重复', noise: '噪音', deferred: '暂缓' };
    const hist = s.state.historical || [];
    const changes = (s.diff.changes || []).filter(c => c.type !== 'annotations_changed');
    const typeWord = { added: '新增', updated: '更新', withdrawn: '撤下', merged: '合并', restored: '恢复' };
    const counts = s.frame.events.reduce((m, e) => (m[e.disposition] = (m[e.disposition] || 0) + 1, m), {});
    const used = s.frame.events.filter(e => e.disposition === 'used').slice(0, 30);
    openSheet(`<h3>折在下面的</h3><p class="d-small">本轮 ${s.frame.events.length} 条输入全部保留：${Object.entries(counts).map(([k, n]) => `${labels[k] || k} ${n}`).join(' · ') || '没有新输入'}。份额只给值得关注的事项。</p>
      ${changes.length ? `<h4>自比较起点的 ${changes.length} 处变化</h4><ul class="d-fold-list">${changes.slice(0, 40).map(c => `<li><small>${typeWord[c.type] || c.type}${c.fields?.length && c.type === 'updated' ? ` · ${c.fields.filter(f => f !== 'sources').join('、')}` : ''}</small><p>${esc(getItem(s.state, c.item)?.title || getItem(s.baseState, c.item)?.title || c.item)}</p></li>`).join('')}</ul>` : ''}
      <h4>采用的输入${used.length < (counts.used || 0) ? `（前 ${used.length} 条）` : ''}</h4><ul class="d-fold-list">${used.map(e => `<li><small>${esc(e.channel)} · ${esc(e.self ? `你（${e.from}）` : e.from)} · ${clock(e.at)}</small><p>${esc(e.why || '')}</p></li>`).join('') || '<li><p>这一轮没有采用的输入。</p></li>'}</ul>
      ${hist.length ? `<h4>已撤下或合并 ${hist.length} 件</h4><ul class="d-fold-list">${hist.slice(-30).reverse().map(h => `<li><small>${h.status === 'merged' ? '已合并' : '已撤下'}</small><p>${esc(h.title)}</p></li>`).join('')}</ul>` : ''}
      <div class="d-sheet-links"><button data-lab-inspect="inputs">全部原始输入 ↗</button><button data-lab-inspect="batch">声明与回执 ↗</button><button data-lab-inspect="diff">变化对比 ↗</button></div>`, '折叠的输入与变化');
  }
  function logSheet() {
    const verb = f => f.meaning === 'ack' ? '已阅' : f.meaning === 'decide' ? `选了「${f.label}」` : f.meaning === 'input' ? `提交「${f.value ?? f.label}」` : f.meaning === 'act' ? `报告「${f.label}」` : `${clock(f.until)} 再提醒`;
    const entries = responses.list(s.cursor).map(f => ({ at: f.at, title: f.title, text: verb(f), id: f.item, key: f.key, status: responseStatus(f, s.frames, s.cursor), local: true }));
    s.frames.slice(0, s.index + 1).forEach((frame, i) => frame.events.forEach(e => (e.feedback || []).forEach(link => entries.push({ at: Date.parse(e.at), title: getItem(s.state, link.target)?.title || getItem(s.records[i].state, link.target)?.title || link.target, text: actionWords(e, link, askAt(i, link.target)), id: link.target, story: true }))));
    entries.sort((a, b) => b.at - a.at);
    openSheet(`<h3>我的回应记录</h3><p class="d-small">按时间倒序。本页点按的只留在演示里；故事里你在原处或回复 Agent 的，标 ↩。</p><ul class="d-fold-list d-log">${entries.slice(0, 80).map(e => `<li><small>${stamp(e.at)}${e.story ? ' · ↩ 故事' : ` · 本页 · ${e.status.status === 'acknowledged' ? '已收到' : '已保存'}`}</small><p><b>${esc(e.title)}</b>${esc(e.text)}</p>${e.local ? `<button type="button" class="d-link" data-undo-key="${esc(e.key)}">撤回</button>` : ''}${getItem(s.state, e.id) ? `<button type="button" class="d-link is-quiet" data-open="${esc(e.id)}">看这件事</button>` : ''}</li>`).join('') || '<li><p>还没有回应过任何事。</p></li>'}</ul>`, '我的回应记录');
  }

  // Answers say “已保存” in their receipt; the words are also read out (no toast pulls the eye to the top).
  const sr = $('.d-sr');
  const say = text => { sr.textContent = text; };
  let toastTimer = null;
  function toast(text) { const t = $('.d-toast'); t.textContent = text; t.classList.add('is-on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), 2200); }

  // ---------- events ----------
  /** Open the detail of an item, growing it from `origin` (the card or row you touched). */
  function openDetail(id, origin = null) {
    if (!id || !getItem(s.state, id)) return;
    closeSheet({ refocus: false });
    detailStack.length = 0;
    detail.origin = origin || homeEl(id);
    holdPlay();
    model.select(id);
    if (peekState) hidePeek(true);
  }
  // Answers, panels and undo for registered asks (and 稍后 on any item) go through respond.mjs.
  const unbindResponses = bindResponses(host, {
    drafts,
    ask: id => currentAsk(s, id),
    respond(target, action, { value, until } = {}) {
      closeSheet({ refocus: false });
      const item = findAny(target);
      if (!item) return;
      if (action.meaning === 'snooze') {
        if (s.selectedId === target) { detail.instant = true; model.select(null); }
        give(item, action, undefined, until);
        return;
      }
      for (const key of [...textDrafts.keys()]) if (key.startsWith(`${target}:`)) textDrafts.delete(key);
      give(item, action, value);
    },
    open(kind, key) {
      if (kind === 'actions') actionsSheet(findAny(key));
      else if (kind === 'compose') composeSheet(key);
      else if (kind === 'keypad') keypadSheet(key);
      else if (kind === 'schedule') scheduleSheet(key);
      else if (kind === 'defer') snoozeSheet(findAny(key));
    },
    undo(target) {
      closeSheet({ refocus: false });
      const item = findAny(target);
      if (!item) return;
      const record = answeredRecord(item) || recordOf(item);
      if (record) responses.removeKey(record.key);
      say('已撤回');
      render('undo', { target });
    },
  });
  host.addEventListener('input', event => { const box = event.target.closest?.('[data-rs-text]'); if (box) textDrafts.set(box.dataset.rsText, box.value); });
  // Finger guard: for 0.4 s after an answer's motion, the button that slid under your finger does not take the tap.
  let lastDown = null, guard = null;
  const onGuard = event => {
    if (!guard || event.detail === 0) return;
    if (performance.now() > guard.until) { guard = null; return; }
    if (Math.hypot(event.clientX - guard.x, event.clientY - guard.y) > 32) return;
    if (event.target.closest(`[data-key="i:${CSS.escape(guard.id)}"]`)) return; // your own receipt (撤回) is yours to tap
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  host.addEventListener('click', onGuard, true);
  // A tap while the summary card is up: on the card or its row it opens the detail from the row; anywhere else it only folds the card away.
  let swallowUntil = 0;
  const onPeekTap = event => {
    // The click a long press or a swipe ends with is not a tap.
    if (performance.now() < swallowUntil) { event.stopImmediatePropagation(); event.preventDefault(); return; }
    const p = peekState;
    if (!p || p.via === 'key') return;
    if (event.target.closest('.d-rail')) { hidePeek(true); return; }
    event.stopImmediatePropagation();
    event.preventDefault();
    if (event.target.closest('.d-peek') || p.row.contains(event.target)) {
      if (p.id === 'fold') { hidePeek(); foldSheet(); } else openDetail(p.id, p.row);
      return;
    }
    hidePeek();
  };
  host.addEventListener('click', onPeekTap, true);
  const outsidePeek = event => { if (peekState && peekState.via !== 'key' && !host.contains(event.target)) hidePeek(); };
  document.addEventListener('click', outsidePeek, true);
  host.addEventListener('click', event => {
    const t = event.target.closest('button, [data-d], .d-card, .d-ask-row, .d-line, .d-tail-item, .d-sheet-backdrop');
    if (!t) return;
    const d = t.dataset;
    if (t.classList.contains('d-sheet-backdrop')) { closeSheet(); return; }
    if (d.ack) { closeSheet({ refocus: false }); give(findAny(d.ack), ACK); return; }
    if (d.ackMany) { const ids = d.ackMany.split(','); for (const id of ids) responses.save(findAny(id), ACK, { at: s.cursor }); say(`已阅 ${ids.length} 件 · 每件各记一条`); render(); return; }
    if (d.undoKey) { responses.removeKey(d.undoKey); say('已撤回'); if (!sheet.hidden && sheet.querySelector('.d-log')) logSheet(); render(); return; }
    if (d.base) { toggleBaseMenu(false); model.setBase(Number(d.base)); return; }
    if (d.open) {
      closeSheet({ refocus: false });
      if (s.selectedId && s.selectedId !== d.open) { detailStack.push(s.selectedId); model.select(d.open); } else if (!s.selectedId) openDetail(d.open, homeEl(d.open));
      return;
    }
    if (d.surface) { surface = d.surface; render(); return; }
    if (d.labInspect) return; // handled by the lab shell
    if (t.closest('[data-rs-act],[data-rs-open],[data-rs-send],[data-rs-undo],[data-rs-pick],[data-rs-defer],[data-rs-amount],[data-rs-schedule],[data-rs-schedule-custom],[data-rs-pad],[data-rs-pad-set]')) return;
    switch (d.d) {
      case 'prev': model.goFrame(s.index - 1); return;
      case 'next': model.goFrame(s.index + 1); return;
      case 'play': model.togglePlay(); return;
      case 'more': open.more = !open.more; render(); if (open.more) revealOpened('more'); return;
      case 'tail': open.tail = !open.tail; render(); if (open.tail) revealOpened('tail'); else scroll.querySelector('[data-key="tail"]')?.focus({ preventScroll: true }); return;
      case 'surface': surface = surface === 'focus' ? 'inbox' : 'focus'; render(); toast(`切到「${surfaces.find(x => x.id === surface).label}」：${surface === 'inbox' ? '已阅即不再占位' : '已阅后仍按份额保留'}`); return;
      case 'fold': foldSheet(); return;
      case 'base': toggleBaseMenu(); return;
      case 'back': model.select(detailStack.pop() || null); return;
      case 'reset': responses.clear(); textDrafts.clear(); render(); toast('已清除本页回应'); return;
      case 'log': logSheet(); return;
      case 'snoozed': openSheet(`<h3>稍后提醒</h3><ul class="d-fold-list">${snoozedItems().map(({ item, f }) => `<li><small>${clock(f.until)} 再提醒 · 你 ${clock(f.at)} 设定</small><p>${esc(item.title)}</p><button type="button" class="d-link" data-rs-undo="${esc(item.id)}">现在就看</button></li>`).join('')}</ul><p class="d-small">往后切换整理时刻，到点后它会回到原位，并注明期间是否有更新。</p>`, '稍后提醒'); return;
    }
    if (t.matches('button')) return;
    if (t.matches(OPENS) && !event.target.closest('textarea, a')) openDetail(t.dataset.id, t);
  });
  host.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.(OPENS)) {
      // Enter and Space on a card or row are its own (ix.mjs): open, not play.
      event.preventDefault(); event.stopPropagation(); openDetail(event.target.dataset.id, event.target); return;
    }
    if (event.key !== 'Escape') return;
    if (!sheet.hidden) { event.stopPropagation(); closeSheet(); return; }
    if (!$('.d-base-menu').hidden) { event.stopPropagation(); toggleBaseMenu(false); $('.d-base-btn').focus(); return; }
    if (peekState && peekState.via !== 'key') { event.stopPropagation(); hidePeek(); return; }
    if (s.selectedId) { event.stopPropagation(); model.select(detailStack.pop() || null); return; }
    if (peekState) { event.stopPropagation(); hidePeek(); }
  }, true);
  // Keyboard focus on a row is its hover: the summary card comes up; Tab on takes it away.
  host.addEventListener('focusin', event => {
    const row = event.target.matches?.(ROWS) && event.target;
    if (row && !restoring && row.matches(':focus-visible') && scroll.contains(row)) showPeek(row.dataset.id, row, 'key');
  });
  host.addEventListener('focusout', event => { if (peekState?.via === 'key' && event.target === peekState.row) hidePeek(); });

  // Long press (0.45 s) instead of hover; 0.15 s in, the row darkens a little to say it is waiting.
  let press = null, pressHeld = false;
  const cancelPress = () => { if (!press) return; clearTimeout(press.hint); clearTimeout(press.fire); press.el.classList.remove('is-pressing'); press = null; };
  // The finger that held is lifted: the click this same touch may still send is not a tap.
  const liftPress = () => { cancelPress(); if (pressHeld) { pressHeld = false; swallowUntil = performance.now() + 150; } };
  host.addEventListener('pointerdown', event => {
    lastDown = { x: event.clientX, y: event.clientY, t: performance.now() };
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const el = event.target.closest(PRESSABLE);
    if (!el || !(scroll.contains(el) || el.matches('.d-fold')) || (event.target.closest('button, textarea, input, a, select') && !event.target.closest('.d-fold') )) return;
    cancelPress();
    press = { el, x: event.clientX, y: event.clientY,
      hint: setTimeout(() => el.classList.add('is-pressing'), PRESS.hint * 1000),
      fire: setTimeout(() => {
        const p = press;
        press = null;
        el.classList.remove('is-pressing');
        if (!p || !el.isConnected) return;
        pressHeld = true;
        swipe = null;
        if (el.matches('.d-card')) openDetail(el.dataset.id, el); // a big card is its own summary: a long press opens it
        else if (el.matches('.d-fold')) showPeek('fold', el, 'press');
        else showPeek(el.dataset.id, el, 'press');
      }, PRESS.hold * 1000) };
  }, true);
  host.addEventListener('pointermove', event => { if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS.slop) cancelPress(); });
  host.addEventListener('pointerup', liftPress);
  host.addEventListener('pointercancel', liftPress);
  host.addEventListener('contextmenu', event => { if (event.target.closest(PRESSABLE)) event.preventDefault(); });
  const onScroll = () => { cancelPress(); if (peekState?.via === 'press' && !ownScroll()) placePeek(peekState.row); };
  addEventListener('scroll', onScroll, { passive: true });
  scroll.addEventListener('scroll', () => { cancelPress(); if (peekState) placePeek(peekState.row); }, { passive: true });

  // Swipe a row of 进行中与结果 left past 80 px to say “知道了”; it follows the finger, and goes on from there when you let go.
  let swipe = null;
  function swipeHint(row) {
    const h = document.createElement('span');
    h.className = 'd-swipe-hint';
    h.setAttribute('aria-hidden', 'true');
    h.textContent = '✓ 知道了';
    h.style.opacity = '0';
    row.append(h);
    return h;
  }
  host.addEventListener('pointerdown', event => {
    const el = event.target.closest('[data-swipe]');
    if (!el || event.target.closest('button') || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.clientX > innerWidth - 16) return; // from the right edge Safari may go forward: not ours
    swipe = { el, x: event.clientX, y: event.clientY, id: el.dataset.swipe, dx: 0 };
  });
  host.addEventListener('pointermove', event => {
    if (!swipe) return;
    const dx = Math.min(0, event.clientX - swipe.x);
    if (!swipe.active && Math.abs(event.clientY - swipe.y) > 8) { swipe = null; return; }
    if (!swipe.active && dx < -8) {
      swipe.active = true; cancelPress(); swipe.el.setPointerCapture?.(event.pointerId);
      swipe.hint = swipeHint(swipe.el);
    }
    if (!swipe.active) return;
    swipe.dx = dx;
    swipe.el.style.transform = `translateX(${dx}px)`;
    // The words it will say stay where the row's right edge was, uncovered as it moves; past 80 px they turn ink.
    swipe.hint.style.transform = `translateX(${-dx}px)`;
    swipe.hint.style.opacity = clamp(-dx / 80).toFixed(2);
    swipe.hint.classList.toggle('is-armed', dx < -80);
  });
  const endSwipe = () => {
    if (!swipe) return;
    const { el, dx, id, active, hint } = swipe;
    swipe = null;
    if (!active) return;
    swallowUntil = performance.now() + 150;
    el.style.transform = '';
    if (dx < -80) { hint.remove(); give(findAny(id), ACK, undefined, undefined, { swipe: { id, dx } }); return; }
    if (reduced()) { hint.remove(); return; }
    // Not far enough: back in 0.20 s from where the finger left it; the words stay put and fade.
    el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 200, easing: EASE });
    const a = hint.animate([{ transform: `translateX(${-dx}px)`, opacity: Number(hint.style.opacity) }, { transform: 'none', opacity: 0 }], { duration: 200, easing: EASE, fill: 'forwards' });
    a.onfinish = a.oncancel = () => hint.remove();
  };
  host.addEventListener('pointerup', endSwipe);
  host.addEventListener('pointercancel', endSwipe);
  // Timeline: every 整理时刻 is a tick; drag or click to move.
  const frameAt = x => { const r = track.getBoundingClientRect(); return Math.round(Math.min(1, Math.max(0, (x - r.left) / r.width)) * (s.frames.length - 1)); };
  let scrubbing = false;
  track.addEventListener('pointerdown', event => { scrubbing = true; track.setPointerCapture(event.pointerId); model.goFrame(frameAt(event.clientX)); });
  track.addEventListener('pointermove', event => { if (scrubbing) { const i = frameAt(event.clientX); if (i !== s.index) model.goFrame(i); } });
  track.addEventListener('pointerup', () => { scrubbing = false; });
  track.addEventListener('keydown', event => { if (event.key === 'Home') { event.preventDefault(); model.goFrame(0); } if (event.key === 'End') { event.preventDefault(); model.goFrame(s.frames.length - 1); } });
  const outside = event => { if (!$('.d-base-menu').hidden && !event.target.closest('.d-base-menu, .d-base-btn')) toggleBaseMenu(false); };
  document.addEventListener('pointerdown', outside);

  function fit() {
    const wide = innerWidth > 760;
    const k = wide ? Math.min(1, (innerHeight - 110) / 864) : 1;
    $('.d-device').style.setProperty('--scale', k.toFixed(3));
  }
  addEventListener('resize', fit); fit();
  const unsubscribe = model.subscribe((next, info) => {
    s = next;
    view.sync(next);
    // A new 整理时刻 (←/→, the track, play, the page above): summary, detail and folds close at once, then the round lands.
    if (info.type === 'frame' && next.index !== lastIndex) {
      turnPending = true;
      closeSheet({ refocus: false });
      hidePeek(true);
      open.more = false; open.tail = false;
    }
    lastIndex = next.index;
    if (turnPending && s.selectedId) { detail.instant = true; model.select(null); return; } // comes back here with the detail closed
    const name = info.type === 'init' ? 'none' : turnPending ? 'turn' : 'local';
    turnPending = false;
    render(name);
  });

  // ---------- hooks for stills and checks (same names and meaning as foldDial / foldPulse) ----------
  const named = name => {
    if (!name) return null;
    if (getItem(s.state, name)) return name;
    const items = s.state.root.items;
    const hit = items.find(x => scenario.categories?.[x.id]?.short === name) || items.find(x => x.title === name) || items.find(x => x.title.includes(name) || currentAsk(s, x.id)?.prompt?.includes(name));
    return hit?.id || null;
  };
  const wordsOf = el => el && (el.querySelector('[data-part="prompt"]') || el.querySelector('[data-part="title"]') || el);
  window.foldHome = {
    model, go: i => model.goFrame(i),
    hover: name => { const id = named(name), el = homeEl(id); if (el) showPeek(id, el, 'pointer'); },
    unhover: () => hidePeek(),
    open: name => { const id = named(name); if (id) openDetail(id, homeEl(id)); },
    close: () => { if (s.selectedId) model.select(null); },
    /** Hold every running animation at `seconds` from its start (null lets them go on). */
    ixAt: seconds => pin(seconds),
    paused: () => !s.playing,
    pointOf: name => { const el = wordsOf(homeEl(named(name))); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 120), y: r.top + r.height / 2 }; },
    rowOf: name => { const el = homeEl(named(name)); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; },
    answer(name, actionId) {
      const id = named(name), ask = id && currentAsk(s, id);
      if (!ask) return null;
      const n = normalizeAsk(ask);
      const action = n.actions.find(a => a.id === actionId) || n.actions.find(a => a.recommended) || n.actions.find(a => a.meaning === 'decide' || a.meaning === 'act') || n.actions[0];
      give(findAny(id), action);
      return action.label;
    },
    undo: name => { const id = named(name); const btn = homeEl(id)?.querySelector('[data-rs-undo]'); if (btn) btn.click(); else { const item = findAny(id); const r = item && (answeredRecord(item) || recordOf(item)); if (r) { responses.removeKey(r.key); render('undo', { target: id }); } } },
    waiting: () => compose().waiting,
    /** Where an item's answer shows now: its open question, whether that counts as answered, and the mark on screen. */
    facts: name => {
      const id = named(name) || name, item = getItem(s.state, id), el = homeEl(id);
      return { id, present: Boolean(item), ask: (item && currentAsk(s, id)?.id) || null, answered: Boolean(item && answeredRecord(item)),
        mark: !el ? null : el.querySelector('.d-receipt') ? 'receipt' : el.matches('.d-ask-row.is-done') ? 'done-row' : el.querySelector('.d-row-receipt') ? 'row' : el.querySelector('.d-prior') ? 'prior' : 'none' };
    },
    top: () => scroll.querySelector('.d-card:not(.is-answered)')?.dataset.id || null,
    keys: () => [...scroll.querySelectorAll(TOP_LEVEL)].map(x => x.dataset.key),
    ixState: () => ({
      hover: peekState?.id || null, open: !panel.hidden && detail.id ? detail.id : null, paused: !s.playing,
      peek: Boolean(peekState) && !peekEl.hidden, inPlace: false,
      detail: !panel.hidden && !panel.classList.contains('is-leaving'),
      clip: panel.hidden ? '' : panel.classList.contains('is-growing') || panel.classList.contains('is-leaving') ? 'growing' : 'none',
      focus: panel.contains(document.activeElement) ? 'detail' : document.activeElement?.matches?.(OPENS) && scroll.contains(document.activeElement) ? 'proxy' : '',
    }),
  };
  return () => {
    disposed = true;
    unsubscribe(); unbindResponses();
    removeEventListener('resize', fit); removeEventListener('popstate', onPop); removeEventListener('scroll', onScroll);
    document.removeEventListener('pointerdown', outside); document.removeEventListener('click', outsidePeek, true);
    document.documentElement.style.overflowAnchor = anchorWas;
    clearTimeout(resumeTimer);
    for (const c of [beat, detail.ctx, peekOut, peekState?.ctx]) settle(c);
    if (window.foldHome?.model === model) delete window.foldHome;
  };
}
