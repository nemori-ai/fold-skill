import { escapeHTML as esc, kindLabel, getItem, colorFor, currentAsk, scenario } from './shared.mjs?v=feedback-loop-1';
import { createResponseStore, composerHTML, keypadHTML, deferHTML, scheduleHTML, bindResponses, normalizeAsk, responseStatus } from '../respond.mjs?v=respond-1';
import { peekHTML } from '../forms/motion/ix.mjs';
import { itemFacts } from '../forms/motion/dial-model.mjs';
import { currentDataset } from '../data/select.mjs';
import { EASE, EASE_IN, EASE_IN_OUT, BEATS, play, stepAt, makeBox, measureEl, ghostOf, morph, reveal, band, popKeys, lookOf } from './d-motion.mjs';
import { RS, clock, stamp, dayLong, weekday, actionWords, createHomeView } from './d-view.mjs';
import { G, HINGE, angleAt, FOLD, foldAt, SETTLE, UNSETTLE, SNAP, HAND, BOOK, DETAIL, UNDETAIL, TURN, BODY, BODY_PAD, FEED, TABLE,
  bodyHTML, panelBodyHTML, pageCutHTML, bandSegments, tween, fade, radius, cornerVars } from './duo-motion.mjs';
import { inputsOf, intoRoot } from './inflow.mjs';

// E · 折叠屏。合上是 D（同一套 d-view.mjs 标记），是折好的结果；展开 = 把折叠摊开：左页按时间摊开本轮的原始输入，
// 采用的按落进哪件分组，每组和右页那张卡同一行、同一高，一条线穿过折痕汇入那张卡；进了 Agent 那边的、暂缓、噪音、
// 重复与撤下的折成灰的几行放在页尾。右页就是外屏，合上时留在手里的正是它。铰链是 Agent 与你的分界：64 格份额带的
// 分界压在折痕上，页头的数字从“N 件”翻成“N 份等你回应”。输入落到哪件与 C 同一条规则（inflow.mjs）。
// 故事与时间表见 forms/polish/duo-motion.md。
//
// 浏览器里没有铰链：折痕上的把手可拖（跟手，松手落到最近的姿态），[ ] 每次 15°，F 一键折 / 展，?hinge=0..1 定格在那个角度
// （0 合上、1 全平），侧栏三个按钮切“合上 / 书本 / 桌面”。开合跟着铰链走，是 iPhone Duo 的翻页：承载外屏的那块板绕折痕
// 向左、朝你翻开（CSS 3D，rotateY），正面是外屏，越翻越像磨砂玻璃、越透明，露出底下一模一样的右页；背面就是内屏左页，
// 靠折痕先清、越往自由边越糊越暗，落平时全清。右页一像素不动。内屏报告跨页（120°）时整理一次（0.40 秒），板继续翻到 180°；
// 往回折过 110° 倒放（0.28 秒）。阈值是常量，待真机量。
// 本页点按的回应只留在内存里，与 D 相同：先“已保存”，下一轮整理后“已收到”；回执跟着条目走，跨姿态、跨折痕、跨版本。

const ITEMS = '.u-half, .u-mini, .d-card, .d-ask-row, .d-line, .d-tail-item';
const PRESSABLE = `${ITEMS}, .u-bandrow, .u-ledger, .d-fold`;
const RS_CONTROLS = '[data-rs-act],[data-rs-amount],[data-rs-open],[data-rs-pick],[data-rs-send],[data-rs-defer],[data-rs-schedule],[data-rs-schedule-custom],[data-rs-pad],[data-rs-pad-set],[data-rs-undo]';
const PRESS = { hint: 0.15, hold: 0.45, slop: 10 };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** One cell of the tabletop's band: 64 of them across its pinned head (its margins and the band row's own 4 pt each side). */
const TCELL = (G.PH - G.rail - 2 * TABLE.pad - 8) / 64;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sum = list => list.reduce((n, it) => n + it.share, 0);
const toNode = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
/** The tell: which round it opens on, which it lands on (the same two rounds D's story uses). */
const TELL = { composite: { start: 'f22', item: 'smilla-vet', action: 'call', next: 'f23' }, story: { start: 'f04', item: 'launch', action: 'fixed', next: 'f05' } };
/** Where E opens when the address names no frame: composite f26 (as D), story f04 (four asks, one of them compact). */
const HOME = { composite: 'f26', story: 'f04' };
let toldOnce = false; // the tell plays once per page load, not again when you come back to E from another variant

export function mount(host, model) {
  // explore.mjs rewrites the address (frame=…, and drops data / posture / hinge) before a variant mounts: what was
  // opened is the navigation's own URL, as variant A reads it.
  const opening = new URL(performance.getEntriesByType?.('navigation')?.[0]?.name || location.href).searchParams;
  const opened = opening.get('variant')?.toLowerCase() === 'duo';
  const params = opened ? opening : new URLSearchParams();
  const askedData = opening.get('data') || currentDataset(); // the shell drops ?data= from the address too
  const dataset = Object.hasOwn(TELL, askedData) ? askedData : 'composite';
  const embedded = (() => { try { return window.top !== window; } catch { return true; } })() || opening.get('embed') === '1';
  const frameIndex = id => Math.max(0, scenario.frames.findIndex(f => f.id === id));
  // The tell plays when E is opened by itself: at the top, no frame, posture or hinge in the address, no referrer.
  const telling = opened && !toldOnce && !params.has('frame') && !params.has('posture') && !params.has('hinge') && !document.referrer && !embedded && !reduced();
  if (opened && !params.has('frame') && !toldOnce) model.goFrame(frameIndex(telling ? TELL[dataset].start : HOME[dataset]));
  toldOnce = true;
  let s = model.snapshot(), surface = 'focus', disposed = false, lastIndex = s.index, turnPending = false;
  const open = { more: false, tail: false };
  const responses = createResponseStore();
  const drafts = new Map();
  const pulsed = new Set();
  const view = createHomeView({ s, responses, open, drafts, surfaceOf: () => surface });
  const { recordOf, answersFor, answeredRecord, priorRecord, compose, whyHTML, traceOf, answerHTML, answerWords, receiptFor, dot,
    chipHTML, rowHTML, tailToggleHTML, tailItemHTML, buildView, headView, detailParts, detailControls, dueOf, dueWords } = view;
  host.classList.add('variant-d');
  const panelBody = panelBodyHTML();

  host.innerHTML = `<div class="u-stage">
    <aside class="d-rail u-siderail" aria-label="回放、姿态与读法">
      <div class="d-rail-brand">Fold <span>E · 折叠屏</span></div>
      <div class="d-rail-time"><span class="d-rail-date"></span><h1 class="d-rail-title"></h1><p class="d-rail-signal"></p></div>
      <div class="d-rail-steps"><button data-u="prev" aria-label="上一轮整理">‹</button><button data-u="play" class="d-play" aria-label="播放"><span aria-hidden="true">▶</span></button><div class="d-track" role="slider" tabindex="0" aria-label="选择整理时刻"><span class="d-track-line"></span><span class="d-track-ticks"></span><span class="d-track-thumb"></span></div><button data-u="next" aria-label="下一轮整理">›</button></div>
      <p class="d-rail-narrative"></p>
      <section class="d-rail-block u-postureblock"><h2>姿态</h2><div class="d-surface-toggle u-postures" role="radiogroup" aria-label="姿态"><button role="radio" data-posture="closed">合上</button><button role="radio" data-posture="book">书本</button><button role="radio" data-posture="table">桌面</button></div>
        <p class="u-hinge-read"></p><p class="d-small">拖折痕上的把手折、展，松手落到最近的姿态；[ ] 每次 15°，F 一键折 / 展。浏览器里的铰链是模拟的：内屏 20° 接管、120° 报告跨页，是待真机量的常量。</p></section>
      <section class="d-rail-block u-tellblock"><h2>讲一遍</h2><p class="d-small u-tell-state"></p><button class="d-link" data-u="replay">重演</button></section>
      <section class="d-rail-block d-legend"><h2>读法</h2><ol>
        <li><b>合上是折好的，翻开是摊开</b>外屏是整理好的结果；翻开时左页把这一轮进来的每条输入摊开：采用的按落进哪件分组，和右页那张卡同一行、同一高，一条线穿过折痕汇进那张卡。</li>
        <li><b>折掉的</b>进了 Agent 那边的、暂缓、噪音、重复，和这一轮撤下或合并的，灰着折在左页下面。页头一排细格是本轮每条输入的时刻：高而黑的成了右页的事，矮而灰的折掉了。</li>
        <li><b>右页就是外屏</b>展开时右页一动不动：承载外屏的那块板绕折痕翻开，正面像毛玻璃一样透出底下同一页，背面就是左页，靠折痕先清，越往外越糊越暗；线随铰链从折痕长进左页。</li>
        <li><b>数字翻成份</b>外屏写“几件等你”；展开后写“64 份里压在你这边的”。份额带一页宽，分界压在折痕上，下面一行是账：空余加 Agent 那边，加你这边，正好 64。</li>
        <li><b>手势</b>轻点按钮作答，右半就地收成回执，左页那组输入折成一行、线缩回折痕；轻点左页一组输入或一行灰的，看那几条的原文（开在左页，右页不动）；轻点卡上的字看这件事的来龙去脉；长按看概要，长按色带格描出那一件；Esc 或点空白收回。</li>
        <li><b>键盘</b>← → 换整理时刻 · 空格播放 · Tab 到条与行 · Enter 看详情 · Esc 返回 · [ ] 调铰链 · F 折 / 展。</li>
      </ol></section>
      <p class="d-small">回应只留在本页内存里，不写回状态：先“已保存”，下一轮整理后“已收到”。<button class="d-link" data-u="reset">清除本页回应</button></p>
    </aside>
    <div class="u-area"><div class="u-device" style="width:${G.W}px;height:${G.L}px;${Object.entries(cornerVars()).map(([k, v]) => `${k}:${v}`).join(';')}">
      <div class="u-body" data-body="open" aria-hidden="true">${bodyHTML()}</div>
      <div class="u-unlit" aria-hidden="true" style="left:${G.crease}px;width:${G.PW}px;height:${G.PH}px"></div><div class="u-lit" aria-hidden="true" style="left:${G.crease}px;width:${G.PW}px;height:${G.PH}px"></div>
      <section class="u-screen u-inner" aria-label="内屏" style="width:${G.W}px;height:${G.PH}px">
        <div class="u-book" style="--pw:${G.PW}px;--gut:${G.gut}px;--gap:${G.gap}px;--rail:${G.rail}px">
          <div class="u-pin"></div>
          <div class="u-iscroll"><div class="u-spread"></div></div>
        </div>
        ${railHTML({ camera: Math.round(0.70 * G.W) })}
      </section>
      <section class="u-screen u-outer" aria-label="外屏" style="left:${G.OX}px;width:${G.S}px;height:${G.L}px">
        <div class="u-ocol" style="right:${G.rail}px;top:${G.top}px">
          <header class="d-head u-ohead"><div class="d-head-main"><div class="d-date"></div></div><h1 class="d-headline" aria-live="polite"></h1><p class="d-since"></p></header>
          <div class="d-scroll u-oscroll"><section class="d-cards" aria-label="等你回应"></section><section class="d-rows" aria-label="进行中与结果"></section><section class="d-known" aria-label="次要事项"></section></div>
          <button class="d-fold u-ofold" data-u="fold" aria-label="本轮的输入：每一条的原文与去向"><span class="d-fold-tex" aria-hidden="true"></span><span class="d-fold-text"></span><span class="d-fold-more" aria-hidden="true">›</span><span class="d-band" aria-hidden="true"></span></button></div>
        ${railHTML({ island: true })}
      </section>
      ${pageCutHTML()}
      <section class="u-screen u-table" aria-label="桌面姿态" hidden style="width:${G.PH}px;height:${G.W}px;--half:${G.PW}px;--rail:${G.rail}px;--bot:${G.W - G.PW}px;--col:${TABLE.col}px;--cgap:${TABLE.gap}px;--tpad:${TABLE.pad}px;--n:${TABLE.cols};--tw:${TABLE.width(TABLE.cols)}px">
        <div class="u-tmain"><div class="u-tpin"></div><div class="u-tview"><div class="u-tcols"><div class="u-tscroll"></div><div class="u-bot"></div><div class="u-tlinks" aria-hidden="true"></div><div class="u-tsnaps" aria-hidden="true"></div></div><i class="u-tedge is-l" aria-hidden="true"></i><i class="u-tedge is-r" aria-hidden="true"></i><div class="u-tdots" aria-hidden="true"></div></div></div><div class="u-trail">${railHTML({})}</div>
      </section>
      <div class="u-fold3d" aria-hidden="true" style="width:${G.W}px;height:${G.L}px;perspective:${FOLD.P}px"><div class="u-panel" style="left:${G.crease}px;width:${G.PW}px">
        <div class="u-face is-front" style="left:${-BODY.spine}px;top:${BODY.y0}px;width:${BODY.spine + BODY.L}px;height:${BODY.H}px">${panelBody.front}
          <div class="u-glass is-front" style="left:${BODY.spine + G.OX - G.crease}px;top:${BODY.top}px;width:${G.S}px;height:${G.L}px"></div><i class="u-glintclip" style="border-radius:${BODY.Rh}px ${BODY.R}px ${BODY.R}px ${BODY.Rh}px"><i class="u-glint"></i></i></div>
        <div class="u-face is-back" style="top:${BODY.y0}px;width:${BODY.L}px;height:${BODY.H}px;transform:translateZ(${-BODY.T}px) rotateY(180deg)">${panelBody.back}
          <div class="u-glass is-back" style="left:${BODY.side}px;top:${BODY.top}px;width:${G.PW}px;height:${G.PH}px"></div><i class="u-glintclip" style="border-radius:${BODY.R}px 0 0 ${BODY.R}px"><i class="u-glint"></i></i></div>
        ${panelBody.edge}
      </div></div>
      <div class="u-clip" aria-hidden="true"></div>
      <button class="u-grip" role="slider" aria-label="铰链：拖动折、展；[ ] 微调，F 折 / 展" aria-valuemin="0" aria-valuemax="180"><i aria-hidden="true"></i><span class="u-grip-read" aria-hidden="true"></span></button>
      <div class="d-peek u-peek" role="tooltip" hidden></div>
      <section class="u-ldetail" aria-label="事项详情" hidden><div class="d-detail-bar"></div><div class="d-detail-body"></div><div class="d-detail-actions"></div></section>
      <div class="u-sheethost"><div class="d-sheet-backdrop" hidden></div><section class="d-sheet" role="dialog" aria-label="操作" hidden></section></div>
      <p class="d-sr" aria-live="polite"></p>
    </div></div>
  </div>`;
  const $ = q => host.querySelector(q);
  const area = $('.u-area'), device = $('.u-device'), inner = $('.u-inner'), outer = $('.u-outer'), table = $('.u-table');
  // the book: its pinned head (both pages' heads, the band and its account) over the stripes, which scroll below it
  const book = $('.u-book'), bpin = $('.u-pin'), spread = $('.u-spread'), iscroll = $('.u-iscroll'), oscroll = $('.u-oscroll'), grip = $('.u-grip');
  const fold3d = $('.u-fold3d'), panelEl = $('.u-panel'), glassF = $('.u-glass.is-front'), glassB = $('.u-glass.is-back');
  const bodyEl = $('.u-body'), clipEl = $('.u-clip'), pageCut = $('.u-pagecut'), sideSheen = $('.u-side > .u-sheen'), sideShade = $('.u-side > .u-shade');
  const glints = [...host.querySelectorAll('.u-face .u-glint')];
  const lit = $('.u-lit'), unlit = $('.u-unlit'), peekEl = $('.u-peek'), panel = $('.u-ldetail'), sheet = $('.d-sheet'), backdrop = $('.d-sheet-backdrop');
  const sheetHost = $('.u-sheethost'), track = $('.d-track');
  // the tabletop: the standing half's pinned head and its groups (they scroll), the flat half's cards (they scroll), the
  // lines between them (drawn over the crease while both halves are at their tops)
  const tPin = $('.u-tpin'), tScroll = $('.u-tscroll'), tBot = $('.u-bot'), tLinks = $('.u-tlinks');
  // the tabletop's strip: both halves' columns in one sideways scroll, a column at a time (TABLE; duo-motion.md 4.1)
  const tCols = $('.u-tcols'), tSnaps = $('.u-tsnaps'), tDots = $('.u-tdots');
  // D's components (cards, tags, buttons, receipts, rows, detail, sheets) and the summary card come with d.css and ix.css,
  // loaded as their own links (as D loads ix.css; the single-file export serves links, not @import): d.css just before
  // duo.css, so the cascade is D's and then E's. The first paint waits for both, so its first measure is right.
  const ownLinks = [];
  const sheetsReady = [['ix-css', './forms/motion/ix.css'], ['duo-d', './variants/d.css']].map(([tag, href]) => {
    let link = document.querySelector(`link[data-${tag}]`);
    if (!link) {
      link = document.createElement('link'); link.rel = 'stylesheet'; link.setAttribute(`data-${tag}`, ''); link.href = href;
      const own = [...document.head.querySelectorAll('link[rel="stylesheet"]')].at(-1); // the shell has just added duo.css
      if (tag === 'ix-css' || !own) document.head.prepend(link); else own.before(link);
      if (tag === 'duo-d') ownLinks.push(link);
    }
    return link.sheet ? null : new Promise(done => { link.addEventListener('load', done, { once: true }); link.addEventListener('error', done, { once: true }); });
  }).filter(Boolean);
  host.style.visibility = 'hidden';
  function railHTML({ island = false, camera = null }) {
    return `<div class="u-sysrail" style="width:${G.rail}px"><i class="u-island${island ? '' : ' is-spot'}" aria-hidden="true"></i><span class="u-clock" aria-hidden="true"></span><span class="u-wifi" aria-hidden="true">◠</span><button type="button" class="u-pill" data-u="log" aria-label="我的回应记录">记<br>录</button></div>${camera ? `<i class="u-cam" style="left:${camera}px" aria-hidden="true"></i>` : ''}`;
  }
  const say = text => { $('.d-sr').textContent = text; };

  // ---------- what each posture shows ----------
  // Facts for the summary card count an item's inputs by the left page's rule (C's, inflow.mjs), so “本轮进了 N 条” there
  // is the number of lines in its group here.
  const facts = id => { try { return itemFacts(s.index, id, intoRoot); } catch { return null; } };
  /** D's “why here” tags, torn by whose fact each is: the Agent's (档位, 份额) on the left page, yours (期限, 新问题, 已等) on the right. */
  function splitWhy(item, ask) {
    const t = document.createElement('template');
    t.innerHTML = whyHTML(item, ask);
    const agent = [], you = [];
    for (const el of t.content.children) (el.matches('.is-weight, .is-share') ? agent : you).push(el.outerHTML);
    return { agent: agent.join(''), you: you.join('') };
  }
  function trendHTML(item, h) {
    const f = facts(item.id);
    if (!f) return '';
    const t = f.trend.slice(0, s.index + 1).slice(-15), max = Math.max(24, ...t);
    return `<span class="u-trend" style="height:${h}px">${t.map((x, k) => `<i class="${k === t.length - 1 ? 'is-now' : ''}${x ? '' : ' is-zero'}" style="height:${Math.max(1, Math.round((x / max) * h))}px"></i>`).join('')}</span>`;
  }

  // ---------- the left page: the fold laid open (duo-motion.md 2.1) ----------
  // The round's inputs (frame.events) in time order, by where C's rule says each went (inflow.mjs): the adopted ones into a
  // root item. Those taken into a card on the right page are that card's group, in its row; those taken into an item on the
  // Agent's side, and the deferred, noise and duplicates, fold into grey lines further down the page.
  const persona = scenario.persona?.name;
  const sourceOf = e => String(e.channel || '').split(' · ')[0] || '来源';
  const whoOf = e => (e.self || (persona && e.from === persona) ? '你' : String(e.from || '').trim() || '—');
  /** A subject without its reply or notice prefixes (“Re: ”, “New comment: ”), to tell one thread from the next. */
  const threadOf = e => String(e.subject || '').replace(/\s+/g, ' ').trim().replace(/^(?:[A-Za-z][A-Za-z ]{0,15}:\s+){1,2}/, '');
  const lineOf = e => String(e.subject || e.text || '').replace(/\s+/g, ' ').trim();
  const DISP_WORD = { deferred: '暂缓', noise: '噪音', duplicate: '重复', unjudged: '未判断' };
  let feedMemo = null;
  /** This round's inputs by where they went: by root item id (adopted), or loose (deferred, noise, duplicate, unjudged). */
  function feed() {
    if (feedMemo?.index === s.index) return feedMemo;
    const plan = inputsOf(s.index, null), by = new Map(), loose = [];
    for (const g of plan.list) { if (g.target) { if (!by.has(g.target)) by.set(g.target, []); by.get(g.target).push(g); } else loose.push(g); }
    const frame = s.frame, prev = s.index ? Date.parse(s.frames[s.index - 1].at) : Date.parse(frame.at) - 1;
    const from = Date.parse(frame.signal?.window?.from || '') || prev, to = Date.parse(frame.signal?.window?.to || '') || Date.parse(frame.at);
    feedMemo = { index: s.index, plan, by, loose, n: plan.list.length, from, to };
    return feedMemo;
  }
  const feedOf = id => feed().by.get(id) || [];
  /** A group's lines: its inputs in time order, a run from one source on one thread folded into one line (×n). */
  function runsOf(gs) {
    const runs = [];
    for (const g of gs) {
      const e = s.frame.events[g.k], src = sourceOf(e), key = `${src}|${threadOf(e)}`, who = whoOf(e), last = runs.at(-1);
      if (last && last.key === key) { last.n += 1; last.ks.push(g.k); if (!last.who.includes(who)) last.who.push(who); continue; }
      runs.push({ key, at: g.at, src, who: [who], n: 1, ks: [g.k], text: lineOf(e) });
    }
    return runs;
  }
  const whoWords = who => (who.length > 2 ? `${who.slice(0, 2).join('、')} 等 ${who.length} 人` : who.join('、'));
  // who sent it, unless that is just the source again (a notice from the service itself)
  const lineHTML = r => `<p class="u-fl"><time>${clock(r.at)}</time><b>${esc(r.src)}</b>${r.who.length === 1 && r.who[0] === r.src ? '' : `<span class="u-fl-who">${esc(whoWords(r.who))}</span>`}${r.n > 1 ? `<span class="u-fl-n">×${r.n}</span>` : ''}<span class="u-fl-t">${esc(r.text)}</span></p>`;
  const bySource = gs => { const m = new Map(); for (const g of gs) { const src = sourceOf(s.frame.events[g.k]); m.set(src, (m.get(src) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
  /**
   * One card's group: its runs, the ones shown (the rest fold into “还有 N 条”), and where each line's middle lies in the
   * group (pt from its top, FEED's fixed metrics) and where the line into the card leaves it (ym, the shown lines' middle).
   */
  function groupOf(item, mode) {
    const gs = feedOf(item.id), runs = runsOf(gs), cap = FEED.cap[mode] ?? FEED.cap.mid;
    const shown = runs.length > cap ? runs.slice(0, cap - 1) : runs, rest = runs.slice(shown.length);
    const y0 = FEED.pad + FEED.head + FEED.sub + FEED.gapTop + FEED.pitch / 2;
    const ys = [...shown, ...(rest.length ? [null] : [])].map((_, j) => y0 + j * FEED.pitch);
    const ym = shown.length ? (ys[0] + ys[shown.length - 1]) / 2 : null;
    return { gs, runs, shown, rest, restN: rest.reduce((n, r) => n + r.n, 0), ys, ym };
  }
  const f1 = v => Math.round(v * 10) / 10;
  /** The line from a group into its card: a funnel from each input line's end, then one line over the crease (SVG). The
   * desc names its shape, so a landing crossfades a line whose shape changed. It grows from the crease with the hinge. */
  function linkHTML(ys, ym, dashed) {
    const F = FEED.funnel, W = F + FEED.run, h = Math.ceil(Math.max(...ys, ym) + 4);
    const stubs = ys.map((y, j) => `<path d="M2 ${f1(y)}C${F * 0.55} ${f1(y)} ${F * 0.45} ${f1(ym)} ${F} ${f1(ym)}"${dashed && j === ys.length - 1 ? ' class="is-rest"' : ''}/>`).join('');
    return `<i class="u-link" data-part="link" aria-hidden="true" style="width:${W}px;height:${h}px"><svg width="${W}" height="${h}" viewBox="0 0 ${W} ${h}"><desc>${ys.length}:${f1(ym)}</desc>${stubs}<path class="is-run" d="M${F} ${f1(ym)}H${W}"/>${ys.map(y => `<circle cx="2" cy="${f1(y)}" r="1.6"/>`).join('')}</svg></i>`;
  }
  const miniLinkHTML = () => { const W = FEED.funnel + FEED.run; return `<i class="u-link is-mini" data-part="link" aria-hidden="true" style="width:${W}px"><svg width="${W}" height="4" viewBox="0 -2 ${W} 4"><desc>mini</desc><path class="is-run" d="M2 0H${W}"/><circle cx="2" cy="0" r="1.6"/></svg></i>`; };
  /** Where the line meets the card: a socket on the card's left edge (its top on the tabletop). */
  const socketHTML = ym => (ym == null ? '' : `<i class="u-socket" aria-hidden="true"${typeof ym === 'string' ? ` data-at="${ym}"` : ` style="top:${f1(ym)}px"`}></i>`);
  const linkOf = (item, mode) => { const g = groupOf(item, mode); return g.ym == null || answeredRecord(item) ? null : g.ym; };
  /** A card's group on the left page (prefix tL on the tabletop): the Agent's facts about it and the inputs it was made of. */
  function leftHalfHTML(item, mode, prefix = 'L') {
    const f = facts(item.id), ask = currentAsk(s, item.id), g = groupOf(item, prefix === 'tL' ? 'table' : mode), id = esc(item.id);
    const tags = ask ? splitWhy(item, ask).agent : `<span class="d-tag is-share">${item.share} 份</span>`;
    const chg = f?.change && !['same', 'new'].includes(f.change.kind) ? `<span class="d-tag">${esc(f.change.text)}</span>` : '';
    const n = g.gs.length;
    const head = `<p class="u-fhead" data-part="head">${dot(colorFor(item, s.state))}<span>${esc(item.title)}</span></p>`;
    if (answeredRecord(item)) {
      // you answered its card: the group folds into one line beside your receipt, the row as tall as the receipt (the
      // line into the card is gone); on the tabletop it lies at the top of its column, over the receipt
      return `<article class="u-half is-left is-feed is-folded is-${mode} u-cl" data-key="${prefix}:${id}" data-id="${id}" data-n="${n}" tabindex="0" aria-label="${esc(`${item.title}：本轮 ${n} 条输入，已折进你的回答`)}">
        ${head}<p class="u-fsum" data-part="sum">${n ? `${n} 条输入` : '本轮没有新输入'} · 已折进你的回答，等 Agent 读到</p></article>`;
    }
    const lines = g.shown.map(lineHTML).join('') + (g.rest.length ? `<p class="u-fl is-rest"><span class="u-fl-t">还有 ${g.restN} 条 · ${esc(bySource(g.rest.flatMap(r => r.ks.map(k => ({ k })))).map(([src, c]) => `${src} ${c}`).join(' · '))}</span></p>` : '');
    // on the tabletop the line runs over the crease between two scrolled halves: it is drawn there (tableLinks), not in the group
    const link = !n || prefix === 'tL' ? '' : linkHTML(g.ys, g.ym, g.rest.length > 0);
    return `<article class="u-half is-left is-feed is-${mode} u-cl" data-key="${prefix}:${id}" data-id="${id}" data-n="${n}"${n && prefix === 'tL' ? ' data-link=""' : ''} tabindex="0" aria-label="${esc(`${item.title}：本轮进了 ${n} 条输入`)}">
      <div class="u-frow">${head}<div class="d-why" data-part="tags">${chg}${tags}</div></div>
      <div class="u-fsub" data-part="sub"><span>${n ? `本轮进了 <b>${n} 条</b>` : '本轮没有新输入'}</span><span class="u-tr"><span class="u-trendlabel">两周份额</span>${trendHTML(item, 14)}</span></div>
      ${n ? `<div class="u-flines" data-part="lines">${lines}</div>` : ''}${link}
    </article>`;
  }
  function rightHalfHTML(item, mode, prefix = 'R') {
    const ask = currentAsk(s, item.id), record = answeredRecord(item), id = esc(item.id);
    // answered: D's answered card, a title line and the receipt (D's answeredHTML), as low as that; the stripe shrinks to it
    if (record) return `<article class="u-half is-right is-answered is-${mode} u-cr" data-key="${prefix}:${id}" data-id="${id}" aria-label="${esc(`已回应：${item.title}`)}">
      <p class="d-kicker" data-part="title">${dot(colorFor(item, s.state))}<span>${esc(item.title)}</span></p>${receiptFor(item, record)}</article>`;
    const trace = traceOf(item, ask), prior = priorRecord(item);
    const isNew = ask.frameIndex === s.index && Date.parse(ask.registered_at) === Date.parse(s.frame.at);
    const priorLine = prior ? `<p class="d-prior" data-part="prior">你 ${clock(prior.at)} 答过上一版：${esc(prior.label)}${prior.value ? `「${esc(prior.value)}」` : ''} · ${responseStatus(prior, s.frames, s.cursor).status === 'acknowledged' ? 'Agent 已收到，问题随后改写' : '已保存'}<button type="button" class="d-undo" data-undo-key="${esc(prior.key)}">撤回</button></p>` : '';
    const ym = linkOf(item, mode);
    return `<article class="u-half is-right is-${mode} u-cr"${isNew ? ' data-new=""' : ''} data-key="${prefix}:${id}" data-id="${id}" aria-label="${esc(`要你答的：${ask.prompt || item.title}`)}">
      ${socketHTML(ym == null ? null : prefix === 'tR' ? 'top' : ym)}<div class="d-why" data-part="why">${splitWhy(item, ask).you}</div>
      <h3 data-part="prompt">${esc(ask.prompt || item.title)}</h3>
      ${trace ? `<p class="d-trace" data-part="trace">${esc(trace)}</p>` : ''}${priorLine}
      ${answerHTML(item, ask, { inDetail: true })}
    </article>`;
  }
  /** A compact stripe's left half: one line, the item and the round's inputs into it (the latest one named). */
  function miniLeftHTML(item, prefix = 'ml') {
    const gs = feedOf(item.id), last = gs.at(-1), e = last && s.frame.events[last.k], done = Boolean(answeredRecord(item));
    const words = done ? `${gs.length ? `${gs.length} 条 · ` : ''}已折进你的回答` : gs.length ? `本轮 ${gs.length} 条 · ${esc(sourceOf(e))} ${esc(whoOf(e))}` : '本轮没有新输入';
    return `<article class="u-mini is-left is-feed${done ? ' is-folded' : ''} u-cl" data-key="${prefix}:${esc(item.id)}" data-id="${esc(item.id)}" data-n="${gs.length}" tabindex="0" aria-label="${esc(`${item.title}：本轮 ${gs.length} 条输入`)}"><p class="d-kicker" data-part="title">${dot(colorFor(item, s.state))}<span>${esc(item.title)}</span></p><span class="u-share" data-part="share">${item.share} 份</span><span class="u-in" data-part="facts">${words}</span>${gs.length && !done ? miniLinkHTML() : ''}</article>`;
  }
  function miniRightHTML({ item, answered }, prefix = 'mr') {
    const ask = currentAsk(s, item.id), due = dueOf(item, ask), d = due != null ? dueWords(due) : null, record = answered ? answeredRecord(item) : null;
    const side = record ? `<span class="d-row-done" data-part="side">✓ ${esc(answerWords(record, ask))}</span>` : chipHTML(item, ask);
    const linked = !record && prefix === 'mr' && feedOf(item.id).length;
    return `<article class="u-mini is-right u-cr${record ? ' is-done' : ''}" data-key="${prefix}:${esc(item.id)}" data-id="${esc(item.id)}" tabindex="0" aria-label="${esc(ask.prompt || item.title)}">${linked ? socketHTML('mid') : ''}<div class="u-mini-text"><h3 data-part="prompt">${esc(ask.short || ask.prompt)}</h3>${d ? `<span class="d-tag${d.hot ? ' is-hot' : ''}" data-part="due">${esc(d.text)}</span>` : ''}</div>${side}</article>`;
  }
  /** D's since-line, torn by whose fact each part is: what came in and changed (the Agent's), what is asked of you and what you did. */
  function sinceParts(v) {
    if (s.index === 0 || s.baseIndex >= s.index) { const did = v.answered ? [`你已回应 ${v.answered} 件`] : []; return { left: '这是比较起点', right: did.join(''), asked: [], did }; }
    const base = s.frames[s.baseIndex], frames = s.frames.slice(s.baseIndex + 1, s.index + 1);
    const received = frames.reduce((n, f) => n + f.events.length, 0);
    const fresh = v.asks.filter(item => Date.parse(currentAsk(s, item.id).registered_at) > Date.parse(base.at)).length;
    const changed = (s.diff.changes || []).filter(c => c.type !== 'annotations_changed').length;
    const mine = new Set(frames.flatMap(f => f.events.filter(e => e.self && e.feedback?.length).flatMap(e => e.feedback.map(l => l.target)))).size;
    // what is asked of you, and what you did (the tabletop's head puts them on two lines of their own)
    const asked = [fresh ? `<b>新问题 ${fresh} 个</b>` : '没有新问题'], did = [mine ? `你在原处处理了 ${mine} 件` : '', v.answered ? `你在这里已回应 ${v.answered} 件` : ''].filter(Boolean);
    return { left: `上次看是 ${stamp(base.at)}，之后收到 ${received} 条，${changed} 处变化`, received, changed, right: [...asked, ...did].join(' · '), asked, did };
  }
  /** Whose turn each share is on: yours (open asks), answered but not yet read, the Agent's, spare. */
  function shares(v) {
    const open_ = v.asks.filter(item => !answeredRecord(item)), pending = v.asks.filter(item => answeredRecord(item));
    const asks = new Set(v.asks.map(item => item.id));
    const agent = [...s.state.root.items].filter(item => !asks.has(item.id)).sort((a, b) => a.rank - b.rank);
    const blank = Math.max(0, s.state.root.budget - s.state.root.used);
    return { open: open_, pending, agent, blank, you: sum(open_), pend: sum(pending), agentShare: sum(agent), waiting: open_.length };
  }
  /**
   * Where the round's inputs went, counted once for the page: into the cards on the right page (mine, and how many cards),
   * into the Agent's side (an item there, or one no longer on the page), folded (not taken in), and the items that left the
   * page this round (withdrawn or merged).
   */
  function census(v) {
    const F = feed(), asks = new Set(v.asks.map(item => item.id));
    let mine = 0, cards = 0;
    for (const id of asks) { const n = feedOf(id).length; mine += n; if (n) cards += 1; }
    const agent = [...F.by].filter(([id]) => !asks.has(id));
    const now = new Set(s.state.root.items.map(x => x.id));
    const gone = (s.index ? s.previousState.root.items : []).filter(x => !now.has(x.id)).map(x => {
      const stored = s.records[s.index].snapshot.items[x.id];
      return { item: x, status: stored?.status || 'withdrawn', into: stored?.merged_into ? getItem(s.state, stored.merged_into) || s.records[s.index].snapshot.items[stored.merged_into] : null };
    });
    const total = s.frames.slice(0, s.index + 1).reduce((n, f) => n + f.events.length, 0);
    return { n: F.n, mine, cards, agent, agentN: agent.reduce((n, [, gs]) => n + gs.length, 0), loose: F.loose, gone, total, counts: F.plan.counts };
  }
  /** The round as 158 ticks along its window: tall and ink, taken into a card on the right page; mid, the Agent's; low, folded. */
  function ticksHTML(v) {
    const F = feed(), asks = new Set(v.asks.map(item => item.id)), W = G.PW - G.gut - G.gap / 2 - 8, H = 14, span = Math.max(1, F.to - F.from);
    const kind = g => (!g.target ? 'is-fold' : asks.has(g.target) ? 'is-you' : 'is-agent');
    const marks = F.plan.list.map(g => `<rect class="${kind(g)}" x="${f1(clamp((g.at - F.from) / span, 0, 1) * (W - 1.4))}" y="${kind(g) === 'is-you' ? 0 : kind(g) === 'is-agent' ? 5 : 9}" width="1.4" height="${kind(g) === 'is-you' ? H : kind(g) === 'is-agent' ? 9 : 5}"/>`).join('');
    return `<svg class="u-ticks" data-part="ticks" width="${f1(W)}" height="${H}" viewBox="0 0 ${f1(W)} ${H}" aria-hidden="true"><desc>${s.index}:${[...asks].join(',')}</desc>${marks}</svg>`;
  }
  function heroHTML(v, sh) {
    if (!v.items.length) return '';
    if (sh.waiting) return `<span class="d-count">${sh.you}</span> 份<small>等你回应</small>`;
    return v.asks.length ? '都回应了<small>等 Agent 整理</small>' : '没有要你回应的事';
  }
  const windowWords = () => { const F = feed(); return `${stamp(F.from)} → ${clock(F.to)}`; };
  /** The lead stripe is the first one still waiting, as D's lead card is: an answered one is no longer one of the three. */
  const modeOf = v => { const lead = v.zone.find(({ item }) => !answeredRecord(item))?.item.id; return item => (item.id === lead ? 'lead' : 'mid'); };
  function bookEntries(v, sh, head) {
    const sp = sinceParts(v), at = new Date(s.cursor), c = census(v);
    const sub = `<b>${sh.waiting} 件</b>${sp.right ? ` · ${sp.right}` : ''}${sh.pend ? ` · 另 ${sh.pend} 份你答过了，等 Agent 读到` : ''}`;
    const fold = c.loose.length;
    const entries = [
      { key: 'h:L', html: `<header class="u-head u-ledger u-cl" data-key="h:L"><div class="d-date" data-part="date">本轮 · ${windowWords()}</div>
        <p class="u-hero-2" data-part="count"><span class="d-count">${c.n}</span> 条输入<small>累计 ${c.total} 条</small></p>${c.n ? ticksHTML(v) : ''}
        <p class="u-sub" data-part="since">${c.n ? `<b>${c.mine}</b> 条成了右页的 ${c.cards} 件 · <b>${c.agentN}</b> 条进了 Agent 那边 · <b>${fold}</b> 条折掉` : '这一轮没有新输入，Agent 按时间重看了一遍'}</p></header>` },
      { key: 'h:R', html: `<header class="u-head u-cr" data-key="h:R"><div class="d-date" data-part="date">${dayLong.format(at)} ${weekday.format(at)} · ${clock(at)}</div>
        <h1 class="u-hero" data-part="count">${heroHTML(v, sh)}</h1><p class="u-sub" data-part="sub">${v.items.length ? sub : ''}</p></header>` },
      { key: 'band', html: '<div class="u-bandrow" data-key="band" aria-hidden="true"><span class="u-band"></span><span class="u-tick"></span></div>' },
      // the band's account, either side of the crease: what is left of it adds up to what is right of it
      { key: 'acct', html: `<div class="u-acct" data-key="acct"><span class="is-l" data-part="l">空余 ${sh.blank} + <b>${sh.agentShare} 份</b>在 Agent 那边（${sh.agent.length} 件）</span><span class="is-r" data-part="r">+ <b>${sh.you} 份</b>等你${sh.pend ? ` + ${sh.pend} 份你答过` : ''} = ${s.state.root.budget || 64} 份</span></div>` },
    ];
    const mode = modeOf(v);
    v.zone.forEach(({ item }) => entries.push({ key: `L:${item.id}`, html: leftHalfHTML(item, mode(item)) }, { key: `R:${item.id}`, html: rightHalfHTML(item, mode(item)) }));
    for (const entry of v.more) entries.push({ key: `ml:${entry.item.id}`, html: miniLeftHTML(entry.item) }, { key: `mr:${entry.item.id}`, html: miniRightHTML(entry) });
    entries.push({ key: 'zone', html: '<section class="u-zone u-cl" data-key="zone" aria-label="Agent 那边"></section>' });
    const others = v.rows.length + v.tail.length;
    entries.push({ key: 'note', html: `<p class="u-note u-cr" data-key="note">${sh.waiting ? `等你的就这 ${sh.waiting} 件。` : '没有等你的事。'}${others || fold ? `左页下面是${others ? ` Agent 那边的 ${others} 件` : ''}${others && fold ? '和' : ''}${fold ? `折掉的 ${fold} 条` : ''}，不用你动。` : ''}</p>` });
    if (fold || c.gone.length) entries.push({ key: 'fold', html: foldedHTML(c) });
    return entries;
  }
  /** Into the Agent's side: one line per item that took inputs this round (its title, how many, from where). */
  function agentFeedHTML(c) {
    if (!c.agentN) return '';
    const live = id => getItem(s.state, id), stored = id => s.records[s.index].snapshot.items[id];
    const lines = c.agent.sort((a, b) => b[1].length - a[1].length).map(([id, gs]) => {
      const item = live(id), st = stored(id), gone = !item || !s.state.root.items.some(x => x.id === id);
      const name = item?.title || st?.title || id, note = gone ? (st?.status === 'merged' ? '（已并入别处）' : '（已撤下）') : '';
      return `<button type="button" class="u-fold-line" data-feed="${esc(item && !gone ? id : `gone:${id}`)}"><b>${esc(name)}${note}</b><span class="u-fl-n">×${gs.length}</span><span class="u-fl-t">${esc(bySource(gs).map(([src]) => src).join('、'))}</span></button>`;
    }).join('');
    return `<div class="u-afeed" data-key="af"><p class="u-fsub" data-part="count">进了 Agent 那边的 <b>${c.agentN} 条</b></p>${lines}</div>`;
  }
  /** What the round folded away, grey: by disposition and source, with its time span; and the items that left the page. */
  /** The folded inputs as grey lines: by disposition, then by source (the biggest three; past four sources the rest are one line). */
  function foldLines(c) {
    const groups = new Map();
    for (const g of c.loose) { const src = sourceOf(s.frame.events[g.k]), key = `${g.disp}|${src}`; if (!groups.has(key)) groups.set(key, { disp: g.disp, src, gs: [] }); groups.get(key).gs.push(g); }
    const lines = [];
    for (const disp of ['deferred', 'noise', 'duplicate', 'unjudged']) {
      const list = [...groups.values()].filter(x => x.disp === disp).sort((a, b) => b.gs.length - a.gs.length);
      const keep = list.length > 4 ? list.slice(0, 3) : list, rest = list.slice(keep.length);
      for (const x of keep) lines.push({ key: `fold:${disp}:${x.src}`, disp, src: x.src, gs: x.gs });
      if (rest.length) lines.push({ key: `fold:${disp}:*`, disp, src: `其他 ${rest.length} 处`, gs: rest.flatMap(x => x.gs).sort((a, b) => a.at - b.at) });
    }
    return lines;
  }
  function foldedHTML(c) {
    const lines = foldLines(c);
    const span = gs => `${clock(gs[0].at)}${gs.length > 1 ? `–${clock(gs.at(-1).at)}` : ''}`;
    const html = lines.map(x => `<button type="button" class="u-fold-line" data-feed="${esc(x.key)}"><span class="u-fd">${DISP_WORD[x.disp] || x.disp}</span><b>${esc(x.src)}</b><span class="u-fl-n">×${x.gs.length}</span><span class="u-fl-t">${span(x.gs)} · ${esc(lineOf(s.frame.events[x.gs[0].k]))}</span></button>`).join('');
    const gone = c.gone.map(x => `<p class="u-fold-line is-gone"><span class="u-fd">${x.status === 'merged' ? '合并' : '撤下'}</span><b>${esc(x.item.title)}</b><span class="u-fl-n">${x.item.share} 份</span><span class="u-fl-t">${x.status === 'merged' && x.into ? `并入「${esc(x.into.title)}」` : '上一轮还在，这一轮撤下'}</span></p>`).join('');
    const k = c.counts, mix = ['deferred', 'noise', 'duplicate', 'unjudged'].filter(d => k[d]).map(d => `${DISP_WORD[d]} ${k[d]}`).join(' · ');
    return `<section class="u-folded u-cl" data-key="fold" aria-label="折掉的输入"><p class="u-fsub" data-part="count">${c.loose.length ? `折掉的 <b>${c.loose.length} 条</b> · ${mix}` : '这一轮没有折掉的输入'}</p>${html}${gone ? `<p class="u-fsub is-gone" data-part="gone">${c.gone.length} 件这一轮离开了页面</p>${gone}` : ''}</section>`;
  }
  function zoneEntries(v) {
    const out = [], af = agentFeedHTML(census(v));
    if (af) out.push({ key: 'af', html: af });
    if (v.rows.length) out.push({ key: 'h:rows', html: `<div class="d-zone-head" data-key="h:rows"><span data-part="count">Agent 在办 · ${v.rows.length}</span></div>` }, ...v.rows.map(item => ({ key: `i:${item.id}`, html: rowHTML(item) })));
    if (v.tail.length) {
      out.push({ key: 'tail', html: tailToggleHTML(v.tail) });
      if (open.tail) out.push(...v.tail.map(item => ({ key: `i:${item.id}`, html: tailItemHTML(item) })));
    }
    return out;
  }
  function tableEntries(v, sh) {
    const sp = sinceParts(v), at = new Date(s.cursor), c = census(v);
    // The columns: what is still to do first, in D's order; what you answered at the end of the strip (duo-motion.md 4.1:
    // what is at hand is what is to do). The three columns that fill the screen are then the three asks waiting, as D's
    // three cards are; an answered column, all but empty (one folded line over a receipt), goes where you scroll to.
    const zone = [...v.zone.filter(({ item }) => !answeredRecord(item)), ...v.zone.filter(({ item }) => answeredRecord(item))];
    const mode = modeOf(v);
    // The head is one height whatever it says (it never pushes the band down): what is asked of you on one line, what you
    // did on the next; the round's numbers on the right, a line each. A line too long ends in “…” instead of wrapping.
    const lines = list => list.map(x => `<span>${x || ''}</span>`).join('');
    const mine = [[`<b>${sh.waiting} 件</b>`, ...sp.asked].join(' · '), sp.did.join(' · ')];
    const round = c.n ? [`<b>${c.mine}</b> 条成了这 ${c.cards} 件 · <b>${c.agentN}</b> 条进了 Agent 那边`, `<b>${c.loose.length}</b> 条折掉 · 空余 ${sh.blank} 份`] : ['这一轮没有新输入', `空余 ${sh.blank} 份`];
    const pinned = [{ key: 'th', html: `<div class="u-thead" data-key="th"><div class="u-thead-l"><div class="d-date" data-part="date">${dayLong.format(at)} ${weekday.format(at)} · ${clock(at)}</div><h1 class="u-hero" data-part="count">${heroHTML(v, sh)}</h1><p class="u-sub u-tlines" data-part="sub">${lines(mine)}</p></div>
      <div class="u-thead-r"><p class="u-hero-2">本轮 ${c.n} 条输入<small>累计 ${c.total} 条</small></p><p class="u-sub u-tlines" data-part="round">${lines(round)}<span class="u-quiet">${sh.agentShare} 份在 Agent 那边（${sh.agent.length} 件）</span></p></div></div>` },
      { key: 'tband', html: '<div class="u-tband" data-key="tband" aria-hidden="true"><span class="u-band"></span><span class="u-tick"></span></div>' },
      // what the Agent has in hand, one line above the groups (what was folded is counted in the head; its lines are the book's);
      // always there, so the pinned head keeps its height from round to round
      { key: 'tline', html: `<p class="u-rowsline" data-key="tline">${v.rows.length || v.tail.length ? `Agent 在办：${v.rows.map(r => esc(r.title)).join('、')}${v.tail.length ? `${v.rows.length ? '；' : ''}另有 ${v.tail.length} 项次要事项` : ''}` : 'Agent 那边没有在办的事'}</p>` }];
    const top = zone.map(({ item }) => ({ key: `tL:${item.id}`, html: leftHalfHTML(item, mode(item), 'tL') }));
    const bot = zone.map(({ item }) => ({ key: `tR:${item.id}`, html: rightHalfHTML(item, mode(item), 'tR') }));
    for (const entry of v.more) bot.push({ key: `tm:${entry.item.id}`, html: miniRightHTML(entry, 'tm') });
    return { n: Math.max(1, zone.length), pinned, top, bot };
  }

  // ---------- keyed patch (as D's): only the leaves whose markup changed are replaced ----------
  function patch(container, entries, removed = new Map(), replaced = new Map()) {
    const existing = new Map();
    for (const node of [...container.children]) { if (node.dataset.key) existing.set(node.dataset.key, node); else if (!node.classList.contains('d-ghost') && !node.classList.contains('d-box')) node.remove(); }
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
    return { removed, replaced };
  }

  // ---------- geometry: device units (pt), whatever the scale the page is shown at ----------
  const scale = () => (device.offsetWidth ? device.getBoundingClientRect().width / device.offsetWidth : 1);
  const devRect = el => { const d = device.getBoundingClientRect(), r = el.getBoundingClientRect(), k = scale(); return { x: (r.left - d.left) / k, y: (r.top - d.top) / k, w: r.width / k, h: r.height / k }; };
  /** A box look for the halves (d-motion's lookOf knows D's cards, rows and folds). */
  function look(el) {
    // a folded group is a ring with no paper in it (it lies beside your receipt): its box crossfades from the group's
    if (el.matches('.u-half.is-left.is-folded')) return { key: 'half-lf', bg: 'transparent', r: 20, ring: true };
    if (el.matches('.u-half.is-left')) return { key: 'half-l', bg: '#fbfaf6', r: 20, ring: true };
    if (el.matches('.u-half.is-answered')) return { key: 'receipt', bg: '#fbfaf6', r: 20, ring: true };
    if (el.matches('.u-half')) return { key: 'card', bg: 'var(--card)', r: 20, drop: true };
    if (el.matches('.u-mini.is-left')) return { key: 'mini-l', bg: '#fbfaf6', r: 16, ring: true };
    if (el.matches('.u-mini')) return { key: el.matches('.is-done') ? 'ask-done' : 'ask', bg: el.matches('.is-done') ? '#fbfaf6' : 'var(--card)', r: 16, ring: true };
    return lookOf(el);
  }
  const measure = (el, k = scale()) => { const m = measureEl(el, k); m.look = look(el); return m; };
  // Leaves only: a container that is itself listed (the 在办 zone on the spread) is not moved as a whole, its rows are —
  // moving both would add the two moves up.
  const snapshotOf = (...roots) => { const k = scale(), map = new Map(); for (const root of roots) for (const el of root.querySelectorAll(':scope > [data-key]')) { if (roots.includes(el)) continue; map.set(el.dataset.key, { m: measure(el, k), node: el }); } return map; };

  // ---------- scrolling (duo-motion.md 4.5): every screen pins its head; under it, its list scrolls on its own ----------
  /** Set a list's scroll; the pinned head over it shows its faint edge only while something has slid under it (CSS). */
  function setScroll(el, y) {
    const max = Math.max(0, el.scrollHeight - el.clientHeight), v = clamp(Math.round(y), 0, max);
    if (el.scrollTop !== v) el.scrollTop = v;
    edgeOf(el);
    return v;
  }
  const edgeOf = el => { const on = el.scrollTop > 0; if (el === iscroll) book.classList.toggle('is-scrolled', on); else if (el === oscroll) outer.classList.toggle('is-scrolled', on); };
  /** The leaves of a layer's list, top to bottom, that can hold a place: the book's stripes and its 在办 rows; the outer screen's
   * cards and rows; the tabletop's cards. */
  const leavesOf = layer => {
    if (layer === 'outer') return [...oscroll.querySelectorAll('.d-cards > [data-key], .d-rows > [data-key], .d-known > [data-key]')];
    if (layer === 'table') return [...tBot.querySelectorAll(':scope > [data-key]')];
    return [...spread.querySelectorAll(':scope > [data-key]:not(.u-zone), :scope > .u-zone > [data-key]')];
  };
  const scrollerOf = layer => (layer === 'outer' ? oscroll : layer === 'table' ? tBot : iscroll);
  /**
   * Keep what you are reading where it is across a redraw (D's pickAnchor / keepAnchor): the item you acted on if it is in
   * view, else the first leaf in view. A list at its top stays at its top, so a new round lands on its top as before.
   */
  function pickAnchor(layer, target) {
    const el0 = scrollerOf(layer);
    if (el0.scrollTop <= 0) return null;
    const top = el0.getBoundingClientRect().top, list = leavesOf(layer);
    const want = target && { outer: [`i:${target}`], book: [`R:${target}`, `mr:${target}`], table: [`tR:${target}`, `tm:${target}`] }[layer];
    const el = (want && list.find(x => want.includes(x.dataset.key))) || list.find(x => x.getBoundingClientRect().bottom > top + 1);
    return el ? { layer, key: el.dataset.key, top: el.getBoundingClientRect().top } : null;
  }
  function keepAnchor(a) {
    if (!a) return;
    const el = leavesOf(a.layer).find(x => x.dataset.key === a.key);
    if (!el) return;
    const d = el.getBoundingClientRect().top - a.top;
    if (Math.abs(d) >= 0.5) { const s0 = scrollerOf(a.layer); s0.scrollTop += d / scale(); edgeOf(s0); }
  }
  /**
   * The scroll carried over the hinge (duo-motion.md 3.3). The outer screen is the book's right page: the first card in view
   * keeps its height (y) on the other screen. The book's pinned head is taller than the outer screen's (the band and its
   * account, D pt): opening, a list at its top stays at its top and its cards move down by D as the band grows; scrolled
   * past D, the card keeps its y exactly; in between, part of D. Folding back, the card keeps its y (at the book's top, the
   * outer screen's top). Back again with nothing scrolled or changed in between: exactly where it was (`carried`).
   */
  let carried = null;
  const bookTwin = key => {
    const z = spread.querySelector(':scope > .u-zone'), q = CSS.escape(key), id = CSS.escape(idOf(key));
    if (key === 'more') return spread.querySelector(':scope > [data-key^="mr:"]');
    if (key.startsWith('i:')) return spread.querySelector(`:scope > [data-key="R:${id}"], :scope > [data-key="mr:${id}"]`) || z?.querySelector(`:scope > [data-key="${q}"]`);
    return z?.querySelector(`:scope > [data-key="${q}"]`) || null;
  };
  const outerTwin = key => {
    const pre = key.slice(0, key.indexOf(':') + 1), id = CSS.escape(idOf(key));
    if (['R:', 'L:', 'mr:', 'ml:'].includes(pre)) return oscroll.querySelector(`.d-cards > [data-key="i:${id}"]`) || (pre.startsWith('m') ? oscroll.querySelector('.d-cards > [data-key="more"]') : null);
    return oscroll.querySelector(`:scope > section > [data-key="${CSS.escape(key)}"]`);
  };
  /** The rest offset D: how much lower the book's first stripe sits than the outer screen's first card, both at their tops. */
  const restGap = () => (iscroll.getBoundingClientRect().top - oscroll.getBoundingClientRect().top) / scale()
    + parseFloat(getComputedStyle(spread).paddingTop) - parseFloat(getComputedStyle(oscroll).paddingTop);
  /** From → to: the first leaf in view on `from` with a twin on the other screen, and that twin. */
  function anchorPair(from, twinOf, view) {
    const k = scale();
    for (const el of from) {
      const r = el.getBoundingClientRect();
      if (r.bottom < view.top + 24 * k) continue; // less than 24 pt of it shows: the next one is what you read
      const twin = twinOf(el.dataset.key);
      if (twin) return { a: r.top, b: twin.getBoundingClientRect().top };
    }
    return null;
  }
  function carryToBook() {
    syncLayers();
    const so = oscroll.scrollTop;
    if (carried?.to === 'outer' && Math.abs(carried.at - so) < 1) return carried.back;
    let si = 0;
    if (so > 0) {
      const p = anchorPair(leavesOf('outer'), bookTwin, oscroll.getBoundingClientRect()), D = restGap();
      si = p ? iscroll.scrollTop + (p.b - p.a) / scale() - Math.max(0, D - so) : so;
    }
    si = clamp(Math.round(si), 0, Math.max(0, iscroll.scrollHeight - iscroll.clientHeight));
    carried = { to: 'book', at: si, back: so };
    return si;
  }
  function carryToOuter() {
    const si = iscroll.scrollTop;
    if (carried?.to === 'book' && Math.abs(carried.at - si) < 1) return carried.back;
    let so = 0;
    if (si > 0) {
      const p = anchorPair(leavesOf('book'), outerTwin, iscroll.getBoundingClientRect());
      so = p ? oscroll.scrollTop + (p.b - p.a) / scale() : si;
    }
    so = clamp(Math.round(so), 0, Math.max(0, oscroll.scrollHeight - oscroll.clientHeight));
    carried = { to: 'outer', at: so, back: si };
    return so;
  }

  // ---------- beats: the same context, settle, arm and pin as D (stills hold every animation at one moment) ----------
  let pinned = null, beat = null, morphCtx = null;
  function newCtx() {
    const c = { anims: [], cleanups: [], done: false };
    c.add = a => { if (pinned != null) { a.pause(); a.currentTime = pinned * 1000; } c.anims.push(a); return a; };
    c.clean = fn => { c.cleanups.push(fn); };
    return c;
  }
  function settle(c) {
    if (!c || c.done) return;
    c.done = true;
    clearTimeout(c.timer);
    for (const a of c.anims) a.cancel();
    for (const fn of c.cleanups.splice(0).reverse()) { try { fn(); } catch (error) { console.error(error); } }
    const after = c.after; c.after = null;
    after?.();
  }
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
    if (pinned == null) for (const c of [beat, morphCtx, detailCtx, peekOut]) if (c && !c.done && c.anims.every(a => a.playState === 'finished')) settle(c);
  }
  const finishAll = () => { for (const c of [beat, morphCtx]) settle(c); };

  /**
   * One list changes between two renders: every leaf that stayed or moved becomes itself in its new place (d-motion morph:
   * one box, its words travelling or crossfading); `fromOf` names where a new leaf comes from when it was another leaf
   * (a stripe's left half becoming a row of 在办); new leaves arrive, left ones leave on a ghost.
   */
  function choreograph(ctx, before, after, { replaced, removed }, { t, tOf = () => t, fromOf = () => null, enter, exit, used = new Set(), exitTo = null }) {
    const k = scale();
    // where a leaf that left rides out (its list: the pinned head and the scrolled stripes are two lists); by default the
    // list of the first leaf, as before there were two
    const exitParent = exitTo || (() => [...after.values()][0]?.node.parentElement);
    // every list's rect, read once before the first write: a read after each morph would lay the page out again each time
    const rects = new Map();
    for (const { node } of after.values()) if (node.parentElement && !rects.has(node.parentElement)) rects.set(node.parentElement, node.parentElement.getBoundingClientRect());
    for (const key of before.keys()) { if (after.has(key)) continue; const p = exitParent(key); if (p && !rects.has(p)) rects.set(p, p.getBoundingClientRect()); }
    for (const [key, { m: now, node: el }] of after) {
      const src = fromOf(key);
      const prev = before.get(src || key);
      if (!prev) { if (enter) enter(el, key); continue; }
      if (src) used.add(src);
      const old = src ? (removed.get(src) || null) : (replaced.get(key) || null);
      const moved = Math.abs(prev.m.left - now.left) > 0.5 || Math.abs(prev.m.top - now.top) > 0.5 || Math.abs(prev.m.height - now.height) > 1;
      if (!old && !moved) continue;
      // a beat may add to what morph does: on the old face riding along (onGhost) or on the new element (onEl)
      const t1 = tOf(key, el, Boolean(src));
      const ghost = morph(ctx, { el, was: prev.m, now, old, k, t: t1, hostRect: rects.get(el.parentElement) });
      t1.onGhost?.(ghost, el);
      t1.onEl?.(el);
    }
    for (const [key, { m }] of before) {
      if (after.has(key) || used.has(key)) continue;
      const node = removed.get(key), parent = exitParent(key);
      if (!node || !exit || !parent) continue;
      const ghost = ghostOf(node, m, k, parent, 0, rects.get(parent));
      ctx.clean(() => ghost.remove());
      exit(ghost, key);
    }
  }

  // ---------- render ----------
  let posture = 'book', angle = 180, phase = 'book', headSig = '';
  let latest = null; // the last composed view and shares
  const visibleLayer = () => (posture === 'table' ? 'table' : phase === 'book' ? 'book' : 'outer');
  /** name: none (first paint) · answer · undo · turn (a new 整理 lands) · local (folds, acks, surface). */
  function render(name = 'local', opts = {}) {
    if (disposed) return;
    const v = compose(), sh = shares(v), head = headView(v);
    latest = { v, sh, head };
    settle(beat);
    const layer = visibleLayer(), animate = name !== 'none' && !reduced();
    const ctx = animate ? newCtx() : null;
    // Only the layer on screen is redrawn on a beat (the reveal also needs the spread it cuts its windows from); the other
    // is brought up to date when it next shows (syncLayers), so a landing does the work of one screen, not two.
    const all = name === 'none';
    // What you are reading stays where it is across the redraw, as on D: the item you acted on, else the first one in view;
    // a list at its top stays at its top. The heads are pinned, so a new round's numbers show without scrolling up.
    const anchor = all ? null : pickAnchor(layer, opts.target);
    const at = which => (anchor && anchor.layer === which ? { ...opts, anchor } : opts);
    // the scroll carried over the hinge holds only while nothing changed on either screen
    if (!all) carried = null;
    if (all || layer === 'outer') { renderOuter(v, sh, head, layer === 'outer' ? ctx : null, name, at('outer')); stale.outer = false; } else stale.outer = true;
    if (all || layer === 'book' || phase === 'reveal') { renderBook(v, sh, head, layer === 'book' ? ctx : null, name, at('book')); stale.book = false; } else stale.book = true;
    for (const c of host.querySelectorAll('.u-clock')) c.textContent = clock(head.at);
    if (posture === 'table') renderTable(v, sh, layer === 'table' ? ctx : null, name, at('table'));
    // the panel is a picture of the two screens: whatever changed under it, it is taken again (now if it is up, else idle)
    fold.ok = false;
    if (panelUp()) buildPanel(); else prebuild();
    renderRail();
    markNew(layer === 'outer' ? outer : layer === 'table' ? table : book, name === 'turn' ? BOOK.land.glow : 0.25);
    if (ctx) { beat = ctx; arm(ctx, () => { beat = null; }); }
    renderDetail();
  }
  const markNew = (root, delay) => {
    for (const el of root.querySelectorAll('[data-new]')) {
      const tag = `${s.index}:${el.dataset.id}:${root === outer ? 'o' : 'i'}`;
      if (pulsed.has(tag) || reduced()) continue;
      pulsed.add(tag);
      el.style.setProperty('--glow-delay', `${delay}s`);
      if (el.classList.contains('is-pulse')) { el.classList.remove('is-pulse'); void el.offsetWidth; } // restart only when it is already on
      el.classList.add('is-pulse');
    }
  };

  let outerBandW = 0;
  function renderOuter(v, sh, head, ctx, name, opts) {
    const built = buildView(v);
    const before = ctx ? snapshotOf($('.d-cards'), $('.d-rows'), $('.d-known')) : null;
    const removed = new Map(), replaced = new Map();
    patch($('.d-cards'), built.cards, removed, replaced);
    patch($('.d-rows'), built.rows, removed, replaced);
    patch($('.d-known'), built.tail, removed, replaced);
    keepAnchor(opts.anchor);
    // anything new on the outer screen: the panel's picture of it is out of date
    const sig = [...built.cards, ...built.rows, ...built.tail].map(e => e.html).join('') + head.headline + head.since + head.fold + JSON.stringify(head.segs);
    if (sig !== sigs.outer) { sigs.outer = sig; fold.ok = false; }
    const headline = $('.d-headline'), was = headline.querySelector('.d-count')?.textContent ?? null;
    if (headline.__html !== head.headline) { headline.__html = head.headline; headline.innerHTML = head.headline; }
    const since = $('.d-since');
    if (since.__html !== head.since) { since.__html = head.since; since.innerHTML = head.since; }
    $('.u-outer .d-date').textContent = `${dayLong.format(head.at)} ${weekday.format(head.at)} · ${clock(head.at)}`;
    for (const c of host.querySelectorAll('.u-clock')) c.textContent = clock(head.at);
    $('.u-outer .d-fold-text').innerHTML = head.fold;
    const bandEl = $('.u-outer .d-band'), B = name === 'answer' ? BEATS.answer : name === 'undo' ? BEATS.undo : name === 'turn' ? BEATS.turn : BEATS.local;
    outerBandW ||= bandEl.offsetWidth; // read once: the bar does not change width
    band(ctx || { add: () => {}, clean: () => {} }, bandEl, head.segs, outerBandW || 300, ctx && name === 'turn' ? B.band : null);
    if (!ctx) return;
    const now = headline.querySelector('.d-count')?.textContent ?? null;
    if (was != null && now != null && was !== now) rollCount(ctx, headline, was, B.hero);
    const after = snapshotOf($('.d-cards'), $('.d-rows'), $('.d-known'));
    const self = opts.target;
    choreograph(ctx, before, after, { replaced, removed }, {
      // the card you answered changes face in place, as on D (its new words, the receipt, arrive with `in`)
      tOf: key => (key === `i:${self}` && B.self ? { ...B.self, move: B.self.box, parts: B.self.box, fresh: B.self.in, flip: B.flip ?? 0, settle: B.self.box[0] + B.self.box[1], z: 2 }
        : { move: B.move, box: B.move, parts: B.move, out: B.swap || B.move, in: B.swap || B.move, fresh: B.fresh, flip: B.flip ?? 0, settle: B.settle }),
      enter: el => reveal(ctx, el, B.enter),
      exit: ghost => play(ctx, ghost, [{ opacity: 1 }, { opacity: 0 }], B.exit),
    });
    if (name === 'answer' && self) popCheck(ctx, $('.d-cards').querySelector(`[data-key="i:${CSS.escape(self)}"]`));
  }
  /** The headline's count turns over in one frame (D's roll, without its one-place slide: shares jump more than one). */
  function rollCount(ctx, el, before, at) {
    const span = el.querySelector('.d-count');
    if (!span || at == null) return;
    const old = document.createElement('span');
    old.className = 'd-count-old'; old.setAttribute('aria-hidden', 'true'); old.textContent = before;
    span.append(old);
    ctx.clean(() => old.remove());
    const text = span.firstChild, now = document.createElement('span');
    now.className = 'd-count-new'; now.textContent = text?.nodeValue ?? '';
    if (text) text.replaceWith(now);
    ctx.clean(() => { if (now.isConnected) now.replaceWith(document.createTextNode(now.textContent)); });
    stepAt(ctx, now, at, true); stepAt(ctx, old, at, false);
  }

  /** The book's pinned head: both pages' heads, the band and its account (the rest of bookEntries scrolls below it). */
  const PIN_KEYS = new Set(['h:L', 'h:R', 'band', 'acct']);
  /** Which list a leaf of the book rides out on when it leaves: the pinned head's or the stripes' (the 在办 rows' too). */
  const bookList = key => (PIN_KEYS.has(key) ? bpin : spread);
  function renderBook(v, sh, head, ctx, name, opts) {
    const zone = () => spread.querySelector(':scope > .u-zone');
    const before = ctx ? snapshotOf(bpin, spread, ...(zone() ? [zone()] : [])) : null;
    const removed = new Map(), replaced = new Map();
    const entries = bookEntries(v, sh, head), zEntries = zoneEntries(v);
    patch(bpin, entries.filter(e => PIN_KEYS.has(e.key)), removed, replaced);
    patch(spread, entries.filter(e => !PIN_KEYS.has(e.key)), removed, replaced);
    patch(zone(), zEntries, removed, replaced);
    book.classList.toggle('is-half', phase === 'book' && angle < HINGE.half && !moving());
    keepAnchor(opts.anchor);
    const bandEl = bpin.querySelector('.u-band'), segs = bandSegments({ open: sh.open, pending: sh.pending, agent: sh.agent, blank: sh.blank });
    const B = name === 'answer' ? BOOK.answer : name === 'undo' ? BOOK.undo : name === 'turn' ? BOOK.land : null;
    paintBand(ctx, bandEl, segs, ctx && B ? B.band : null, ctx && B ? B.band[0] : 0);
    // anything new on the spread: the panel's picture of the left page is out of date
    const sig = [...entries, ...zEntries].map(e => e.html).join('') + JSON.stringify(segs);
    if (sig !== sigs.book) { sigs.book = sig; fold.ok = false; }
    // the lines into the cards and the band's account, as grown as the hinge has them (they grow with the band)
    live.links = [...spread.querySelectorAll(':scope > .u-cl > .u-link')];
    live.sockets = [...spread.querySelectorAll(':scope > .u-cr > .u-socket')];
    live.acct = bpin.querySelector(':scope > .u-acct');
    applyGrowth();
    if (!ctx) return;
    const after = snapshotOf(bpin, spread, zone());
    const self = opts.target, L = BOOK.local;
    if (name === 'answer' || name === 'undo') {
      // The stripe you answered folds as one (duo-motion.md 3.4, D's 3a): its right half into D's answered card, its group of
      // inputs into one line as tall, both in place and at the same pace (feedBeat), the line into the card drawn back to the
      // crease; then the stripes below close up in one move and the ask that comes out of the fold grows into a stripe out of
      // its compact one (BOOK.answer.others). Taken back: the same backwards, the stripe growing as the ones below make room.
      choreograph(ctx, before, after, { replaced, removed }, {
        exitTo: bookList,
        fromOf: pairing(before),
        tOf: key => (key === `R:${self}` || key === `mr:${self}` ? { ...B.self, z: 2 } : key === `L:${self}` || key === `ml:${self}` ? feedBeat(ctx, name) : { ...B.others, flip: B.hero }),
        enter: el => reveal(ctx, el, B.enter),
        exit: g => play(ctx, g, [{ opacity: 1 }, { opacity: 0 }], B.exit),
      });
      if (name === 'answer') popCheck(ctx, spread.querySelector(`[data-key="R:${CSS.escape(self)}"]`));
      return;
    }
    if (name === 'turn') { land(ctx, before, after, { replaced, removed }); return; }
    choreograph(ctx, before, after, { replaced, removed }, { t: L, exitTo: bookList, fromOf: pairing(before), enter: el => reveal(ctx, el, L.enter), exit: g => play(ctx, g, [{ opacity: 1 }, { opacity: 0 }], L.exit) });
  }
  /**
   * You answer a card: its group of inputs folds into one line beside your receipt, and the line into the card is drawn
   * back to the crease as it fades (on the old face riding along). Taking the answer back unfolds it and the line grows
   * out of the crease again (FEED.fold / unfold).
   */
  const feedBeat = (ctx, name, move = null) => {
    const T = { ...(name === 'answer' ? FEED.fold : FEED.unfold), ...(move ? { move } : {}) };
    return { ...T, z: 1,
      onGhost: g => { const l = name === 'answer' && g?.querySelector(':scope > [data-part="link"]'); if (l) play(ctx, l, [{ transform: 'none' }, { transform: 'scaleX(0)' }], T.line, { easing: EASE_IN }); },
      onEl: el => { const l = name === 'undo' && el.querySelector(':scope > [data-part="link"]'); if (l) play(ctx, l, [{ transform: 'scaleX(0)' }, { transform: 'none' }], T.line); } };
  };
  /** The receipt's check comes in under your finger as it does on D: from a little smaller, 0.12–0.30 s. */
  const popCheck = (ctx, el) => { const check = el?.querySelector('.d-check'); if (check) play(ctx, check, [{ opacity: 0, transform: 'scale(.55)' }, { opacity: 1, transform: 'none' }], [0.12, 0.18]); };
  /** Which leaf a new one was before: a stripe's half and its compact stripe, a stripe's left half and its row of 在办. */
  const idOf = key => key.slice(key.indexOf(':') + 1);
  const pairing = before => key => {
    if (before.has(key)) return null;
    const id = idOf(key), has = k => before.has(k) ? k : null;
    if (key.startsWith('i:')) return has(`L:${id}`) || has(`ml:${id}`);
    if (key.startsWith('L:')) return has(`ml:${id}`) || has(`i:${id}`);
    if (key.startsWith('R:')) return has(`mr:${id}`);
    if (key.startsWith('ml:')) return has(`L:${id}`) || has(`i:${id}`);
    if (key.startsWith('mr:')) return has(`R:${id}`);
    return null;
  };
  /** 64 cells, the boundary on the crease (duo-motion.mjs bandSegments); d-motion's band() moves and rescales the runs. */
  function paintBand(ctx, el, segs, span, at) {
    if (!el) return;
    const cell = G.cell;
    el.style.left = `${G.crease - 64 * cell}px`; // cell 64 of the band's own coordinates is the crease
    band(ctx || { add: () => {}, clean: () => {} }, el, segs, 64 * cell, span);
    const kinds = new Map(segs.map(x => [x.id, x.kind]));
    const apply = () => { for (const node of el.children) node.className = kinds.get(node.dataset.seg) || node.className; };
    if (ctx && at > 0) { const timer = setTimeout(apply, at * 1000); ctx.clean(() => { clearTimeout(timer); apply(); }); } else apply();
  }
  /**
   * The next 整理 lands on the spread (duo-motion.md 3.5): the receipt fills; the count turns; the answered stripe goes over the
   * fold — its receipt in one diagonal stroke to the row's receipt line, its left half down to the row it becomes; a question
   * that lapsed leaves its right half; the rest move once; new asks arrive; a new question is outlined once.
   */
  function land(ctx, before, after, { replaced, removed }) {
    const B = BOOK.land, k = scale(), used = new Set();
    const view = iscroll.getBoundingClientRect(), spreadRect = spread.getBoundingClientRect(); // read before the beat writes anything
    const fromOf = pairing(before);
    const lead = new Set();
    for (const key of after.keys()) { const src = fromOf(key); if (src?.startsWith('L:') && key.startsWith('i:')) lead.add(idOf(key)); }
    choreograph(ctx, before, after, { replaced, removed }, {
      used,
      exitTo: bookList,
      fromOf,
      tOf: (key, el, crossed) => {
        if (key === 'h:L' || key === 'h:R') return { move: B.move, box: B.move, parts: B.move, out: B.receipt, in: [B.hero, 0.2], fresh: [B.hero, 0.2], flip: B.hero, settle: B.hero };
        if (crossed && lead.has(idOf(key))) return { move: B.lead, box: B.lead, parts: B.lead, out: [B.lead[0], 0.2], in: [B.lead[0] + 0.2, 0.2], fresh: [B.lead[0] + 0.24, 0.16], flip: B.hero, settle: B.lead[0] + B.lead[1], z: 3, ease: EASE_IN_OUT };
        return { move: B.move, box: B.move, parts: B.move, out: [B.move[0], 0.16], in: [B.move[0] + 0.12, 0.2], fresh: [B.move[0] + 0.14, 0.18], flip: B.hero, settle: B.move[0] + B.move[1] };
      },
      enter: el => reveal(ctx, el, B.enter),
      exit: (ghost, key) => {
        const id = idOf(key);
        // The answered stripe's right half: its receipt fills, then travels to its row; the half itself fades.
        const receipt = ghost.querySelector('.d-receipt');
        const row = after.get(`i:${id}`);
        if (key.startsWith('R:') && receipt && row) {
          const target = row.node.querySelector('[data-part="receipt"]');
          // where it is and where it goes, from the measures taken with everything else (no layout read after a write)
          const at = (m, name) => { const p = m.parts?.get(name); return p ? { left: m.left + p.x * k, top: m.top + p.y * k, width: p.w * k, height: p.h * k } : { left: m.left, top: m.top, width: m.width, height: m.height }; };
          const from = at(before.get(key).m, 'receipt'), to = at(row.m, 'receipt');
          // the row is off the page (below the fold of the list): the receipt leaves by the left page's bottom edge instead
          const off = to.top > view.bottom - 24;
          const dx = (to.left - from.left) / k, dy = ((off ? view.bottom - from.height * 0.6 : to.top) - from.top) / k;
          // Only the receipt travels: lift it out of the half's ghost so the box can fade on its own.
          const fly = receipt.cloneNode(true);
          ghostOf(fly, from, k, ghost.parentElement, 4, spreadRect);
          fly.classList.remove('is-face'); fly.classList.add('u-fly'); fly.style.visibility = 'visible';
          // a paper chip round it, so it reads as one thing crossing the fold
          Object.assign(fly.style, { left: `${parseFloat(fly.style.left) - 10}px`, top: `${parseFloat(fly.style.top) - 7}px`, width: 'max-content', height: `${parseFloat(fly.style.height) + 14}px` });
          receipt.style.visibility = 'hidden';
          // it fills in place first (Agent has read it), then goes over the fold
          const note = fly.querySelector('small'); if (note) note.textContent = `已收到 · Agent 在 ${clock(s.frame.at)} 的整理中读到`; // the cut: it has been read
          const check = fly.querySelector('.d-check');
          if (check) play(ctx, check, [{ backgroundColor: 'var(--card)', color: 'var(--ink)' }, { backgroundColor: 'var(--ink)', color: '#fff' }], B.receipt);
          play(ctx, fly, [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 1, offset: off ? 0.7 : 0.85 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 }], B.lead, { easing: EASE_IN_OUT });
          ctx.clean(() => fly.remove());
          if (target) play(ctx, target, [{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1 }], B.lead, { easing: 'linear' });
          play(ctx, ghost, [{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], [0, B.lead[0] + 0.12], { easing: 'linear' });
          return;
        }
        play(ctx, ghost, [{ opacity: 1 }, { opacity: 0 }], key.startsWith('R:') ? B.lapse : B.exit);
      },
    });
  }

  /** Which list a leaf of the tabletop rides out on: the standing half's head, its groups, or the flat half's cards. */
  const tableList = key => (key.startsWith('tL:') ? tScroll : key.startsWith('tR:') || key.startsWith('tm:') ? tBot : tPin);
  let tableN = 0;
  /**
   * The tabletop (duo-motion.md 4.1). One column per stripe, every column TABLE.col wide whatever is in it, the same columns
   * for both halves: the standing half's groups over the flat half's cards, column for column. Past three, the strip runs
   * on to the right and both halves scroll sideways together, a column at a time; each half scrolls up and down on its own.
   */
  function renderTable(v, sh, ctx, name, opts) {
    const t = tableEntries(v, sh);
    const before = ctx ? snapshotOf(tPin, tScroll, tBot) : null;
    const left0 = tCols.scrollLeft;
    if (t.n !== tableN) {
      tableN = t.n;
      table.style.setProperty('--n', String(t.n));
      table.style.setProperty('--tw', `${TABLE.width(t.n)}px`);
      // where the strip comes to rest: a column's left edge at the screen's margin (scroll-padding), a column at a time
      tSnaps.innerHTML = Array.from({ length: t.n }, (_, j) => `<i style="left:${f1(TABLE.pad + j * TABLE.step)}px"></i>`).join('');
      tDots.innerHTML = t.n > TABLE.cols ? '<i></i>'.repeat(t.n) : '';
    }
    const removed = new Map(), replaced = new Map();
    patch(tPin, t.pinned, removed, replaced);
    patch(tScroll, t.top, removed, replaced);
    patch(tBot, t.bot, removed, replaced);
    // taken back, the column goes back to its place among the ones to do: if that is off the screen, the strip follows it
    if (name === 'undo' && opts.target) showColumn(opts.target);
    keepAnchor(opts.anchor);
    const bandEl = tPin.querySelector('.u-band');
    if (bandEl) {
      const cell = TCELL, x0 = ((sh.agentShare + sh.blank) / 64) * 64 * cell;
      bandEl.style.left = '0px';
      band({ add: () => {}, clean: () => {} }, bandEl, bandSegments({ open: sh.open, pending: sh.pending, agent: sh.agent, blank: sh.blank }).map(x => ({ ...x, from: x.from - 64 + (x0 / cell) })), 64 * cell, null);
      const kinds = new Map(bandSegments({ open: sh.open, pending: sh.pending, agent: sh.agent, blank: sh.blank }).map(x => [x.id, x.kind]));
      for (const node of bandEl.children) node.className = kinds.get(node.dataset.seg) || '';
      tPin.querySelector('.u-tick').style.left = `${x0}px`;
    }
    const B = name === 'answer' ? BOOK.answer : name === 'undo' ? BOOK.undo : null;
    const after = ctx ? snapshotOf(tPin, tScroll, tBot) : null;
    // the lines over the crease go with their columns; the answered one's is drawn back first, a new column's comes last
    const slide = tCols.scrollLeft - left0, S = B?.strip;
    tableLinks(ctx, B ? { out: B.line, move: S, in: [S[0] + S[1] - 0.04, 0.2] } : BOOK.local, slide);
    stripEdges();
    if (!ctx) return;
    if (B) {
      // The card you answered folds into D's answered card in place and its group into one line at the top of the column
      // (0–0.20 s); a moment later that column goes to the end of the strip while the ones to do close up to the left, and the
      // ask out of the fold comes in where the last of them was (revealed in place, as D's does; its compact one in the flat
      // half's last row leaves); B.strip. Taken back, the same backwards, at once.
      const self = opts.target;
      const others = { move: S, box: S, parts: S, out: [S[0], 0.12], in: [S[0] + 0.06, 0.2], fresh: [S[0] + S[1] - 0.12, 0.16], flip: B.hero, settle: S[0] + S[1] };
      choreograph(ctx, before, after, { replaced, removed }, {
        exitTo: tableList,
        tOf: key => (key === `tR:${self}` || key === `tm:${self}` ? { ...B.self, move: S, z: 2 } : key === `tL:${self}` ? feedBeat(ctx, name, S) : key.startsWith('t') && !['th', 'tband', 'tline'].includes(key) ? others : { ...B.others, flip: B.hero }),
        enter: el => reveal(ctx, el, [S[0] + S[1] * 0.5, 0.32]),
        exit: g => play(ctx, g, [{ opacity: 1 }, { opacity: 0 }], B.exit),
      });
      if (name === 'answer') popCheck(ctx, tBot.querySelector(`[data-key="tR:${CSS.escape(self)}"]`));
      return;
    }
    choreograph(ctx, before, after, { replaced, removed }, { t: { ...BOOK.local, flip: 0 }, exitTo: tableList, enter: el => reveal(ctx, el, BOOK.local.enter), exit: g => play(ctx, g, [{ opacity: 1 }, { opacity: 0 }], BOOK.local.exit) });
  }
  /** Bring a column into view, by the fewest columns (it lands on a column's edge: the strip snaps there anyway). */
  function showColumn(id) {
    const el = tBot.querySelector(`:scope > [data-key="tR:${CSS.escape(id)}"], :scope > [data-key="tm:${CSS.escape(id)}"]`);
    if (!el) return;
    const j = [...tBot.querySelectorAll(':scope > [data-key^="tR:"]')].indexOf(el);
    if (j < 0) return;
    const x = j * TABLE.step, view = tCols.clientWidth - 2 * TABLE.pad;
    if (x < tCols.scrollLeft) tCols.scrollLeft = x;
    else if (x + TABLE.col > tCols.scrollLeft + view + 0.5) tCols.scrollLeft = x + TABLE.col - view;
  }
  /** The strip runs on past the screen's edge: a paper fade and a hairline on that side (the pinned heads' edge, turned),
   * and the page dots say which columns are on the screen. */
  const stripEdges = () => {
    const max = tCols.scrollWidth - tCols.clientWidth, x = tCols.scrollLeft;
    table.classList.toggle('is-more-l', x > 1);
    table.classList.toggle('is-more-r', x < max - 1);
    const from = Math.round(x / TABLE.step);
    [...tDots.children].forEach((dot, j) => dot.classList.toggle('is-on', j >= from && j < from + TABLE.cols));
  };
  /**
   * The tabletop's lines (duo-motion.md 4.1): each group that took inputs drops one straight line over the crease into the
   * top of its card. The groups and the cards are two lists that scroll up and down on their own, so the line lies over the
   * crease, apart from both, measured as they stand at their tops; it shows only while both are there. It lies in the strip,
   * so it goes sideways with its column; when the columns change places (an answer), it goes with its column (T.move;
   * slide: how far the strip itself was scrolled meanwhile, pt). Scrolled away, the line and the card's socket fade.
   */
  function tableLinks(ctx, T, slide = 0) {
    if (table.hidden) return; // drawn when the tabletop shows (showLayers): hidden, nothing has a place to measure
    const k = scale(), L = tLinks.getBoundingClientRect(), view = tScroll.getBoundingClientRect();
    const was = new Map([...tLinks.children].filter(x => !x.classList.contains('is-leaving')).map(x => [x.dataset.id, x]));
    // every place is read before the first line is written
    const want = [];
    for (const g of tScroll.querySelectorAll(':scope > [data-link]')) {
      const id = g.dataset.id, card = tBot.querySelector(`:scope > [data-key="tR:${CSS.escape(id)}"]`);
      if (!card) continue;
      const r = g.getBoundingClientRect(), c = card.getBoundingClientRect();
      // as at the tops of both lists: the foot of the group (or of the standing half, when the group runs on below it) to the card's top
      const foot = Math.min(r.bottom + tScroll.scrollTop * k, view.bottom), top = c.top + tBot.scrollTop * k;
      want.push({ id, x: (r.left + r.width / 2 - L.left) / k, y0: (foot - L.top) / k - 5, y1: (top - L.top) / k + 3 });
    }
    for (const { id, x, y0, y1 } of want) {
      let line = was.get(id);
      was.delete(id);
      if (!line) {
        line = document.createElement('i'); line.className = 'u-dline'; line.dataset.id = id; tLinks.append(line);
        if (ctx) play(ctx, line, [{ opacity: 0 }, { opacity: 1 }], T.in || BOOK.local.enter);
      } else if (ctx && T.move) {
        const dx = parseFloat(line.style.left) - x + slide;
        if (Math.abs(dx) > 0.5) play(ctx, line, [{ transform: `translateX(${f1(dx)}px)` }, { transform: 'none' }], T.move);
      }
      Object.assign(line.style, { left: `${f1(x)}px`, top: `${f1(y0)}px`, height: `${f1(Math.max(0, y1 - y0))}px` });
    }
    for (const line of was.values()) {
      if (!ctx) { line.remove(); continue; }
      line.classList.add('is-leaving');
      play(ctx, line, [{ opacity: 1 }, { opacity: 0 }], T.out || BOOK.local.exit);
      ctx.clean(() => line.remove());
    }
    apartTable();
  }
  /** Either half of the tabletop scrolled off its top: the lines over the crease and the cards' sockets fade; the standing
   * half's groups slid under its head, or the cards under the crease: that edge shows (CSS). */
  const apartTable = () => {
    table.classList.toggle('is-apart', tScroll.scrollTop > 0.5 || tBot.scrollTop > 0.5);
    table.classList.toggle('is-tscrolled', tScroll.scrollTop > 0);
    table.classList.toggle('is-bscrolled', tBot.scrollTop > 0);
  };

  // ---------- the hinge: the fold (follows it), settle (once, timed), fold back (once, timed, then follows it) ----------
  /**
   * The panel (duo-motion.mjs FOLD): a picture of the two screens, taken when it goes up (or ahead of time, when the page is
   * idle), turned about the crease with the hinge. Its face is the outer screen: a copy, and a blurred copy under a mask
   * that slides in from the free edge, and a paper frost. Its back is the spread's left page: a copy, three blurred copies
   * under sliding masks, and the veil. Under it only the right page is live, and it does not move.
   */
  // scroll: how far the book's stripes are scrolled in the picture; dirty: the outer screen scrolled since it was taken
  const fold = { ok: false, scroll: 0, dirty: false, half: false, front: null, frost: null, back: [], veil: null, bands: [], spreads: [], books: [], oscrolls: [], outers: [], os: 0, idle: 0, links: [], accts: [] };
  /** The spread's own lines into the cards and its band account (renderBook keeps them). */
  const live = { links: [], sockets: [], acct: null };
  const growthNow = () => foldAt(panelUp() ? angle : phase === 'book' || posture === 'table' ? HINGE.flat : 0).band;
  /**
   * The lines from the groups into the cards grow out of the crease with the band (FOLD.band, 120° → 170°) and draw back
   * into it when the hinge folds; the band's account fades in with them. Only transforms and opacities: on the spread, and
   * on the panel's sharp copy of the left page (the blurred copies never reach the crease, so they carry none).
   */
  function applyGrowth(g = growthNow()) {
    const t = g < 1 ? `scaleX(${g.toFixed(4)})` : '', o = g < 1 ? g.toFixed(3) : '';
    for (const l of live.links) if (l.style.transform !== t) l.style.transform = t;
    for (const k of live.sockets) if (k.style.opacity !== o) k.style.opacity = o;
    if (live.acct && live.acct.style.opacity !== o) live.acct.style.opacity = o;
    if (!panelUp() || !fold.ok) return;
    for (const l of fold.links) l.style.transform = t;
    for (const a of fold.accts) a.style.opacity = o;
  }
  const sigs = { book: '', outer: '' };
  let lastFold = null;
  const panelUp = () => posture !== 'table' && angle > 0 && angle < HINGE.flat;
  const moving = () => Boolean(hingeTween?.live) || Boolean(drag?.moved);
  /** A copy for the panel: no keys, ids, focus, ghosts or one-off marks (the back's sharp copy keeps the items' ids). */
  function scrub(root, keepIds) {
    for (const x of root.querySelectorAll('.d-ghost, .d-box, .d-cover, .u-fly, .d-count-old')) x.remove();
    const marks = ['is-pulse', 'is-peeked', 'is-linked', 'is-pressing', 'is-morphing', 'is-open'];
    for (const x of [root, ...root.querySelectorAll(`[data-key], [id], [tabindex], [data-new], [aria-live], ${keepIds ? '' : '[data-id], '}${marks.map(m => `.${m}`).join(', ')}, button, a, textarea, input`)]) {
      x.removeAttribute('data-key'); x.removeAttribute('id'); x.removeAttribute('data-new'); x.removeAttribute('aria-live');
      if (!keepIds) x.removeAttribute('data-id');
      x.classList.remove(...marks);
      if (x.matches('button, a, textarea, input, [tabindex]')) x.setAttribute('tabindex', '-1');
    }
    return root;
  }
  /** Heights of the right column's leaves in the pinned head and in the stripes (the copy empties them to boxes this tall). */
  const columnHeights = () => [bpin, spread].map(list => [...list.children].map(el => (el.matches('.u-cr') ? el.offsetHeight : 0)));
  /**
   * The book as it stands, for the back: its right column emptied to boxes of the same height, so every row keeps its height;
   * its head where it is pinned, its stripes moved by the scroll inside the scroll region's clip.
   */
  function bookCopy(heights, keepIds) {
    const c = book.cloneNode(true);
    [c.querySelector('.u-pin'), c.querySelector('.u-spread')].forEach((list, i) => [...list.children].forEach((el, j) => {
      if (el.matches('.d-ghost, .d-box')) { el.remove(); return; }
      if (el.matches('.u-cr')) { el.replaceChildren(); Object.assign(el.style, { height: `${heights[i][j]}px`, minHeight: '0', visibility: 'hidden' }); }
    }));
    scrub(c, keepIds);
    c.classList.add('u-clone');
    Object.assign(c.style, { width: `${G.W}px`, height: `${G.PH}px` });
    c.querySelector('.u-spread').style.transform = `translateY(${-fold.scroll}px)`;
    return c;
  }
  /** A blurred copy under a mask twice its width: the mask slides along x and the copy slides back, both by transform. */
  function maskedLayer(content, width, height, blur, side) {
    const mask = document.createElement('div'), shift = document.createElement('div'), body = document.createElement('div');
    mask.className = `u-mask ${side}`; shift.className = 'u-shift'; body.className = 'u-blur';
    Object.assign(mask.style, { width: `${2 * width}px`, height: `${height}px` });
    Object.assign(body.style, { width: `${width}px`, height: `${height}px`, filter: `blur(${blur}px)` });
    body.append(content); shift.append(body); mask.append(shift);
    return { el: mask, shift, width };
  }
  /** Put a layer's mask edge (its middle) at x on its face. */
  const slide = (layer, x) => {
    layer.el.style.transform = `translateX(${(x - layer.width).toFixed(1)}px)`;
    layer.shift.style.transform = `translateX(${(layer.width - x).toFixed(1)}px)`;
  };
  /**
   * Take the picture. Opening from closed, the book is where the outer screen carries it (carryToBook: at its top when the
   * outer screen is at its top, so the left page reads from the top as before); folding back from the book, as you leave it.
   * Every layout read comes before the copies are written.
   */
  function buildPanel({ keepScroll = phase === 'book' } = {}) {
    syncLayers();
    if (!keepScroll) setScroll(iscroll, carryToBook());
    fold.scroll = iscroll.scrollTop; fold.dirty = false;
    const heights = columnHeights(), os = fold.os = oscroll.scrollTop;
    // the face: the outer screen as it is, and a blurred copy of it masked in from the free edge; the frost over both
    const o = scrub(outer.cloneNode(true), false);
    o.classList.remove('is-off'); o.classList.add('u-clone'); o.style.left = '0px';
    fold.front = maskedLayer(o.cloneNode(true), G.S, G.L, FOLD.front.blur, 'is-f');
    fold.frost = document.createElement('i'); fold.frost.className = 'u-frost';
    glassF.replaceChildren(o, fold.front.el, fold.frost);
    // the back: the left page, sharp (its items answer a tap when the panel rests half-folded), three blurred copies, the veil
    const sharp = document.createElement('div');
    sharp.className = 'u-layer'; sharp.append(bookCopy(heights, true));
    const proto = bookCopy(heights, false);
    // the lines into the cards and the band's account lie by the crease, where the page is never blurred: only the sharp
    // copy carries them (the account keeps its row, so every row below stays where it is)
    for (const x of proto.querySelectorAll('.u-link')) x.remove();
    for (const x of proto.querySelectorAll('.u-acct')) x.style.visibility = 'hidden';
    fold.back = FOLD.back.radii.map((r, j) => maskedLayer(j ? proto.cloneNode(true) : proto, G.PW, G.PH, r, 'is-b'));
    fold.veil = document.createElement('i'); fold.veil.className = 'u-veil'; fold.veil.style.width = `${2 * G.PW}px`;
    glassB.replaceChildren(sharp, ...fold.back.map(l => l.el), fold.veil);
    fold.spreads = [...glassB.querySelectorAll('.u-spread')];
    fold.books = [...glassB.querySelectorAll('.u-book')];
    fold.bands = [...glassB.querySelectorAll('.u-band')];
    fold.links = [...sharp.querySelectorAll('.u-link')];
    fold.accts = [...sharp.querySelectorAll('.u-acct')];
    fold.half = book.classList.contains('is-half');
    fold.oscrolls = [...glassF.querySelectorAll('.u-oscroll')];
    fold.outers = [...glassF.querySelectorAll('.u-outer')];
    for (const sc of fold.oscrolls) if (os) sc.scrollTop = os;
    fold.ok = true;
    applyFold();
  }
  /**
   * The picture follows a scroll without being taken again: the book's stripes move under its pinned head, the outer screen's
   * list under its own; opening, the book first follows the outer screen (it is the right page then).
   */
  function panelScroll() {
    fold.dirty = false;
    if (!fold.ok) return;
    if (phase !== 'book') setScroll(iscroll, carryToBook());
    // read both offsets first, then write: a scroll of the book only moves the stripes' copies (a transform, no layout)
    const top = iscroll.scrollTop, os = oscroll.scrollTop;
    fold.scroll = top;
    for (const c of fold.spreads) c.style.transform = `translateY(${-top}px)`;
    for (const c of fold.books) c.classList.toggle('is-scrolled', top > 0);
    if (os === fold.os) return;
    fold.os = os;
    for (const sc of fold.oscrolls) sc.scrollTop = os;
    for (const o of fold.outers) o.classList.toggle('is-scrolled', os > 0);
  }
  /** Take the picture ahead of time, once nothing is moving, so the first frame of a turn has nothing to build. */
  function prebuild() {
    clearTimeout(fold.idle);
    if (reduced() || disposed) return;
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 0));
    const busy = () => [beat, morphCtx, detailCtx].some(c => c && !c.done) || moving() || Boolean(drag);
    const attempt = () => {
      if (disposed || fold.ok || panelUp() || posture === 'table') return;
      if (busy()) { fold.idle = setTimeout(attempt, 400); return; }
      // a beat may have started since: then wait for it again rather than build under it
      idle(() => { if (disposed || fold.ok || panelUp() || posture === 'table') return; if (busy()) fold.idle = setTimeout(attempt, 400); else buildPanel(); }, { timeout: 800 });
    };
    fold.idle = setTimeout(attempt, 700);
  }
  /** One frame of the fold at the current angle: what is lit, the panel's turn, its frost, blur and veil, the band's growth. */
  function applyFold() {
    const up = panelUp();
    if (up && !fold.ok) { buildPanel(); return; }
    // the outer screen was scrolled after the picture was taken: it follows (the book with it) as the panel lifts
    if (up && fold.dirty) panelScroll();
    const table_ = posture === 'table';
    fold3d.classList.toggle('is-up', up);
    inner.classList.toggle('is-lifted', up && phase === 'book');
    // the right page: the outer screen while closed (at 0°) and while the inner screen shows its right page (reveal);
    // between 0° and the takeover the outer screen is on the panel and the inner screen has not lit yet
    outer.classList.toggle('is-off', table_ || !(phase === 'reveal' || (phase === 'closed' && angle <= 0)));
    // as the right page the outer screen is cut to the inner screen's height (it is 9 pt taller), so the page's lower edge
    // does not step when the spread is reported (a cover that fades: pageCutHTML)
    pageCut.classList.toggle('is-on', !table_ && phase === 'reveal');
    // lying flat, the whole inner screen is lit (its hairline the same as before the turn existed)
    const whole = !table_ && phase === 'book' && !up;
    lit.classList.toggle('is-on', !table_ && (phase === 'reveal' || whole));
    lit.classList.toggle('is-whole', whole);
    unlit.classList.toggle('is-on', !table_ && phase === 'closed' && angle > 0);
    // the body that does not move: the tabletop's; the half in your hand while the other is on the panel; open; closed
    const shell = table_ ? 'table' : up ? 'right' : phase === 'book' ? 'open' : 'closed';
    if (bodyEl.dataset.body !== shell) { bodyEl.dataset.body = shell; clipEl.dataset.body = shell; }
    const f = foldAt(up ? angle : phase === 'book' || table_ ? HINGE.flat : 0);
    lastFold = up ? f : null;
    const grow = f.band < 1 ? `scaleX(${f.band.toFixed(4)})` : '';
    const band = bpin.querySelector(':scope > .u-bandrow .u-band');
    if (band && band.style.transform !== grow) band.style.transform = grow;
    applyGrowth(f.band);
    if (!up) return;
    fold3d.classList.toggle('is-live', phase === 'book' && !moving());
    fold3d.style.perspectiveOrigin = `${f.camX.toFixed(1)}px ${Math.round(G.L * FOLD.eye)}px`;
    // the panel is a slab T thick: its front (the outer screen) turns about the crease and its back (the left page) lands
    // where the front was, so the slab slides T along its normal over the turn — nothing jumps at 0° or 180°
    panelEl.style.transform = `rotateY(${(-f.a).toFixed(2)}deg) translateZ(${((BODY.T * f.a) / HINGE.flat).toFixed(2)}px)`;
    const b = f.body;
    sideSheen.style.opacity = b.sheen.toFixed(3);
    sideShade.style.opacity = b.shade.toFixed(3);
    glints[0].style.opacity = b.glint.front.toFixed(3);
    glints[1].style.opacity = b.glint.back.toFixed(3);
    // the band's centre crosses its face from 1.1 to −0.1 of the face's width (the front face is the spine wider)
    glints.forEach((g, i) => {
      const w = i ? BODY.L : BODY.spine + BODY.L, x = (1.1 - 1.2 * b.glint.at[i]) * w - 113;
      g.style.transform = `translateX(${x.toFixed(1)}px) rotate(14deg)`;
    });
    glassF.style.opacity = f.front.alpha.toFixed(3);
    slide(fold.front, f.front.cut);
    fold.frost.style.opacity = f.front.frost.toFixed(3);
    fold.back.forEach((layer, j) => {
      const L = f.layers[j];
      layer.el.style.opacity = L.on ? '1' : '0';
      if (L.on) slide(layer, Math.max(-G.PW, L.cut));
    });
    fold.veil.style.transform = `translateX(${(f.veil.edge - G.PW).toFixed(1)}px)`;
    fold.veil.style.opacity = f.veil.alpha.toFixed(3);
    for (const b of fold.bands) b.style.transform = grow;
    const half = book.classList.contains('is-half');
    if (half !== fold.half) { fold.half = half; for (const c of fold.books) c.classList.toggle('is-half', half); }
  }
  const stale = { outer: false, book: false };
  function syncLayers() {
    if (!latest) return;
    if (stale.outer) { stale.outer = false; renderOuter(latest.v, latest.sh, latest.head, null, 'none', {}); }
    if (stale.book) { stale.book = false; renderBook(latest.v, latest.sh, latest.head, null, 'none', {}); }
  }
  function showLayers() {
    syncLayers();
    const open_ = posture !== 'table' && phase === 'book';
    inner.classList.toggle('is-on', open_);
    const turned = table.hidden === (posture === 'table');
    table.hidden = posture !== 'table';
    grip.hidden = posture === 'table';
    device.classList.toggle('is-table', posture === 'table');
    // half-folded only at rest: a hand passing 150° on its way open does not re-lay the spread
    book.classList.toggle('is-half', open_ && angle < HINGE.half && !moving());
    applyFold();
    fit();
    // the tabletop starts at the tops of both halves (a turn of the screen is a new layout); its lines are drawn now that it shows
    if (posture === 'table' && turned) { tScroll.scrollTop = 0; tBot.scrollTop = 0; tCols.scrollLeft = 0; tableLinks(null, BOOK.local); stripEdges(); }
  }
  /**
   * The hinge starts to fold or open (anywhere but the book's own half-folded range): what lay over a screen goes at once,
   * as ix's interruption rule has it — the detail, a summary card, a sheet — then the fold goes on as usual.
   */
  function interrupt() {
    hidePeek(true); closeSheet({ refocus: false });
    if (!detail.id && !s.selectedId) return;
    settle(detailCtx);
    detail.id = null; detail.origin = null; detail.loose = null; detail.mode = 'item';
    markOpen(null);
    panel.hidden = true; panel.classList.remove('is-leaving', 'is-growing');
    if (s.selectedId) model.select(null);
  }
  function setAngle(a) {
    if (posture === 'table') return;
    const prev = angle;
    angle = clamp(a, 0, HINGE.flat);
    if (angle !== prev && (phase !== 'book' || angle < HINGE.back)) interrupt();
    // folding back past 110°: the settle runs backwards, then the fold follows the hinge (in one call when it jumps)
    if (phase === 'book' && angle < HINGE.back) unsettle();
    if (phase === 'book') book.classList.toggle('is-half', angle < HINGE.half && !moving());
    else if (angle >= HINGE.stable) settleSpread();
    else {
      const next = angle >= HINGE.takeover ? 'reveal' : 'closed';
      if (next !== phase) { phase = next; showLayers(); }
    }
    applyFold();
    renderGrip();
  }
  /** The spread is reported: right halves compact, the folded asks fan out, 件 turns to 份 (0.40 s); the panel goes on turning. */
  function settleSpread() {
    settle(morphCtx);
    const animate = !reduced() && phase === 'reveal';
    // the book where the panel's picture of its left page has it: where the outer screen carried it (its top when the outer
    // screen was at its top). A hinge that jumped straight here (no picture), or an outer screen scrolled since: carried now.
    const top = fold.ok && !fold.dirty ? fold.scroll : carryToBook();
    const k = scale(), cards = new Map();
    for (const card of outer.querySelectorAll('.d-cards > [data-key]')) cards.set(card.dataset.key, { m: measure(card, k), node: card });
    const headline = outer.querySelector('.d-headline'), date = outer.querySelector('.d-date'), bar = outer.querySelector('.d-fold');
    const hm = animate ? { r: headline.getBoundingClientRect(), node: headline.cloneNode(true) } : null;
    const dm = animate ? date.getBoundingClientRect() : null, fm = animate ? { r: bar.getBoundingClientRect(), node: bar.cloneNode(true) } : null;
    phase = 'book';
    setScroll(iscroll, top);
    showLayers();
    stale.book = false; renderBook(latest.v, latest.sh, latest.head, null, 'none', {});
    applyFold();
    renderRail();
    if (!animate) return;
    const ctx = newCtx();
    morphCtx = ctx;
    // The right page only: the left page is on the panel's back, pinned where it lands. The buttons, the tags left to you and
    // the trace slide to their place; the Agent's words leave the card (they are on the left page now).
    const S = SETTLE, compact = { move: S.compact, box: S.compact, parts: S.compact, out: [0, 0.12], in: [0.06, 0.2], fresh: [0.10, 0.18], flip: S.hero, settle: S.compact[1], keep: new Set(['answer', 'why', 'trace']) };
    for (const [key, { m: was, node }] of cards) {
      const id = key.slice(2), R = spread.querySelector(`[data-key="R:${CSS.escape(id)}"]`);
      if (!R) continue;
      morph(ctx, { el: R, was, now: measure(R, k), old: node.cloneNode(true), k, t: { ...compact, z: 2 }, hostRect: spread.getBoundingClientRect() });
    }
    const more = cards.get('more')?.m;
    for (const el of spread.querySelectorAll(':scope > .u-mini.is-right')) {
      if (more) morph(ctx, { el, was: { ...more, parts: new Map() }, now: measure(el, k), old: null, k, t: { move: S.minis, box: S.minis, parts: S.minis, fresh: S.minis, out: S.minis, in: S.minis, flip: 0, settle: S.minis[1] }, hostRect: spread.getBoundingClientRect() });
      else play(ctx, el, [{ opacity: 0 }, { opacity: 1 }], S.minis);
    }
    fade(ctx, spread.querySelector('.u-note'), true, S.rows, 14);
    const headR = bpin.querySelector('[data-key="h:R"]');
    if (headR) {
      const hero = headR.querySelector('.u-hero'), sub = headR.querySelector('.u-sub'), d = headR.querySelector('.d-date');
      const to = hero.getBoundingClientRect(), dx = (hm.r.left - to.left) / k, dy = (hm.r.top - to.top) / k;
      play(ctx, hero, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], S.compact);
      stepAt(ctx, hero, S.hero, true);
      const ghost = ghostOf(hm.node, hm.r, k, headR, 3);
      play(ctx, ghost, [{ transform: 'none' }, { transform: `translate(${-dx}px, ${-dy}px)` }], S.compact);
      stepAt(ctx, ghost, S.hero, false);
      ctx.clean(() => ghost.remove());
      stepAt(ctx, sub, S.hero, true);
      const dr = d.getBoundingClientRect();
      play(ctx, d, [{ transform: `translate(${(dm.left - dr.left) / k}px, ${(dm.top - dr.top) / k}px)` }, { transform: 'none' }], S.compact);
    }
    if (fm) {
      const ghost = ghostOf(fm.node, fm.r, k, clipEl, 6); // in the screen's shape: it sinks away inside the glass, not over the bezel
      play(ctx, ghost, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(24px)', opacity: 0 }], S.ledger);
      ctx.clean(() => ghost.remove());
    }
    arm(ctx, () => { if (morphCtx === ctx) morphCtx = null; });
  }
  /** Folding back past 110°: the settle backwards on the right page, faster (0.28 s); the panel goes on folding with the hinge. */
  function unsettle() {
    settle(morphCtx);
    const animate = !reduced();
    const k = scale(), halves = new Map();
    for (const el of spread.querySelectorAll(':scope > [data-key]')) halves.set(el.dataset.key, { m: measure(el, k), node: el });
    // the outer screen brought up to date first and scrolled to where the book carries it (the card you were reading keeps
    // its height; at the book's top, the outer screen's top), then the picture of the left page as you leave it
    syncLayers();
    setScroll(oscroll, carryToOuter());
    if (angle > 0 && !fold.ok) buildPanel({ keepScroll: true }); else panelScroll();
    phase = 'reveal';
    showLayers();
    renderRail();
    if (!animate) return;
    const ctx = newCtx();
    morphCtx = ctx;
    const U = UNSETTLE, t = { move: U.expand, box: U.expand, parts: U.expand, out: [0, 0.1], in: [0.08, 0.18], fresh: [0.12, 0.16], flip: U.hero, settle: U.total };
    for (const card of outer.querySelectorAll('.d-cards > [data-key]')) {
      const id = card.dataset.key.slice(2), R = halves.get(`R:${id}`);
      if (R) morph(ctx, { el: card, was: R.m, now: measure(card, k), old: R.node.cloneNode(true), k, t, hostRect: card.parentElement.getBoundingClientRect() });
      else if (card.dataset.key === 'more') play(ctx, card, [{ opacity: 0 }, { opacity: 1 }], U.minis);
    }
    const headline = outer.querySelector('.d-headline');
    stepAt(ctx, headline, U.hero, true);
    arm(ctx, () => { if (morphCtx === ctx) morphCtx = null; });
  }

  // ---------- postures ----------
  let hingeTween = null;
  function tweenTo(target, seconds = null, ease) {
    hingeTween?.cancel();
    if (posture === 'table') return;
    const dist = Math.abs(target - angle);
    const dur = reduced() ? 0 : seconds ?? Math.max(SNAP.min, SNAP.half * dist / 90);
    if (!dur) { setAngle(target); return; }
    hingeTween = tween(angle, target, dur, a => setAngle(a), () => { hingeTween = null; setAngle(target); }, ease);
  }
  function setPosture(name, { animate = !reduced() } = {}) {
    hidePeek(true); closeSheet();
    if (s.selectedId) model.select(null); else if (detail.loose) closePanel();
    if (name === 'table') {
      if (posture === 'table') return;
      hingeTween?.cancel();
      const from = visibleLayer() === 'book' ? inner : outer, shell = bodyEl.dataset.body;
      posture = 'table'; phase = 'book'; angle = 180;
      renderTable(latest.v, latest.sh, null, 'none', {});
      showLayers();
      if (animate) turnIn(from, false, shell);
      renderRail(); renderGrip();
      return;
    }
    if (posture === 'table') {
      posture = 'book';
      const fromTable = table;
      phase = name === 'closed' ? 'closed' : 'book';
      angle = name === 'closed' ? 0 : 180;
      stale.book = false; renderBook(latest.v, latest.sh, latest.head, null, 'none', {});
      showLayers();
      if (animate) turnIn(fromTable, true, 'table');
      renderRail(); renderGrip();
      if (!fold.ok) prebuild();
      return;
    }
    tweenTo(name === 'closed' ? 0 : 180, animate ? null : 0);
  }
  /** The system turns the screen: the old layout fades, the new one comes in, its columns one by one (0.36 s). The body
   * turns with it: the old one (`shell`) fades over the new one at the same pace. */
  function turnIn(from, back = false, shell = null) {
    const ctx = newCtx();
    const ghost = from.cloneNode(true);
    ghost.hidden = false; ghost.classList.remove('is-off', 'is-on');
    ghost.classList.add('u-turn-ghost');
    device.append(ghost);
    ctx.clean(() => ghost.remove());
    play(ctx, ghost, [{ opacity: 1 }, { opacity: 0 }], TURN.out);
    if (shell && shell !== bodyEl.dataset.body) {
      // only the shell being left (and its keys): every shell is a layer of its own, so cloning all four would raster four
      const old = document.createElement('div');
      old.className = 'u-body u-body-ghost'; old.dataset.body = shell; old.setAttribute('aria-hidden', 'true');
      old.append(bodyEl.querySelector(`.u-shell[data-shell="${shell}"]`).cloneNode(true), bodyEl.querySelector(`.u-keys[data-shell="${shell === 'table' ? 'table' : 'book'}"]`).cloneNode(true));
      device.append(old);
      ctx.clean(() => old.remove());
      play(ctx, old, [{ opacity: 1 }, { opacity: 0 }], TURN.out);
    }
    const items = back ? [...spread.querySelectorAll(':scope > .u-half, :scope > .u-mini')] : [...tPin.children, ...tScroll.children, tLinks, ...tBot.children];
    items.forEach((el, j) => play(ctx, el, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], [TURN.in[0] + Math.min(8, j % 4) * TURN.stagger, TURN.in[1]]));
    settle(beat); beat = ctx; arm(ctx, () => { beat = null; });
  }
  function renderGrip() {
    const x = G.crease;
    grip.style.left = `${x}px`;
    grip.setAttribute('aria-valuenow', String(Math.round(angle)));
    grip.setAttribute('aria-valuetext', `${Math.round(angle)}°，${postureWords()}`);
    $('.u-grip-read').textContent = `${Math.round(angle)}°`;
    $('.u-hinge-read').textContent = `铰链 ${Math.round(angle)}° · ${postureWords()}`;
    host.querySelectorAll('[data-posture]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.posture === (posture === 'table' ? 'table' : phase === 'book' ? 'book' : 'closed'))));
  }
  const postureWords = () => (posture === 'table' ? '桌面：上半立着看，下半平放按' : phase === 'book' ? (angle < HINGE.half ? '半折书本：两半离开折痕' : '全开书本') : phase === 'reveal' ? '展开中：前板绕折痕翻开，右页不动' : angle > 0 ? '合上中：内屏还没亮' : '合上：外屏');

  // ---------- fit: the device at its point size, scaled into what is left beside the rail ----------
  function fit() {
    const w = posture === 'table' ? G.PH : G.W, h = posture === 'table' ? G.W : G.L;
    device.style.width = `${w}px`; device.style.height = `${h}px`;
    const room = area.getBoundingClientRect();
    // the shell's switcher sits at the bottom of the window (hidden when embedded in all.html or the site's viewer)
    const bar = document.querySelector('.lab-switcher'), reserve = bar && getComputedStyle(bar).display !== 'none' ? 104 : 24;
    // the body reaches past the screens (the left half, the keys, its shadow): fit that, not just the screens
    const pad = BODY_PAD[posture === 'table' ? 'table' : 'book'], W = w + pad.l + pad.r, H = h + pad.t + pad.b;
    const k = Math.max(0.3, Math.min(1.1, room.width / W, (innerHeight - room.top - window.scrollY - reserve) / H));
    device.style.setProperty('--k', k.toFixed(4));
    device.style.setProperty('--dx', `${(Math.max(0, (room.width - W * k) / 2) + pad.l * k).toFixed(1)}px`);
    device.style.setProperty('--dy', `${(pad.t * k).toFixed(1)}px`);
    area.style.height = `${Math.ceil(H * k) + 8}px`;
  }
  addEventListener('resize', fit);
  // embedded (all.html, the site's viewer, a preview shot) hides the shell's switcher: refit when that class changes
  const refit = new MutationObserver(() => fit());
  refit.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // ---------- rail ----------
  function renderRail() {
    $('.d-rail-date').textContent = `${stamp(s.frame.at)} · ${s.index + 1}/${s.frames.length}`;
    $('.d-rail-title').textContent = s.frame.title;
    $('.d-rail-narrative').textContent = s.frame.narrative || '';
    const signal = s.frame.signal;
    $('.d-rail-signal').textContent = signal ? (signal.type === 'review' ? `调用原因：${signal.reason}，窗口内 0 条事件` : `调用原因：${signal.reason || '收到新输入'} · ${signal.received} 条`) : '初始状态';
    const playBtn = $('.d-play');
    playBtn.setAttribute('aria-label', s.playing ? '暂停' : '播放');
    playBtn.firstElementChild.textContent = s.playing ? '❚❚' : '▶';
    playBtn.classList.toggle('is-on', Boolean(s.playing));
    const n = s.frames.length - 1, pos = i => `${(i / Math.max(1, n)) * 100}%`;
    if (!track.__built) { $('.d-track-ticks').innerHTML = s.frames.map((f, i) => `<i style="left:${pos(i)}"></i>`).join(''); track.__built = true; }
    [...$('.d-track-ticks').children].forEach((tick, i) => tick.classList.toggle('is-past', i <= s.index));
    $('.d-track-thumb').style.left = pos(s.index);
    track.setAttribute('aria-valuemin', '1'); track.setAttribute('aria-valuemax', String(n + 1)); track.setAttribute('aria-valuenow', String(s.index + 1));
    $('.u-tell-state').textContent = tell.running ? '正在讲：合上 → 展开 → 答一件 → 下一轮落地 → 合上。任意键或点按跳过。' : tell.done ? '讲完了，可以重演。' : '直接打开本页（不带参数）时演一遍；带帧号、从别处链来或在合页里时不演。';
    renderGrip();
  }

  // ---------- peek: long press (or keyboard focus) is the hover ----------
  let peekState = null, peekOut = null, linked = null;
  function showPeek(id, el, via, at = null) {
    if (!id || !el) return;
    hidePeek(true);
    const item = getItem(s.state, id), f = item && s.state.root.items.some(x => x.id === id) ? facts(id) : null;
    peekEl.innerHTML = f ? peekHTML(f) : `<div class="ix-q">${esc(item?.title || id)}</div><div class="ix-d">${item ? `${item.share} 份 · ${esc(kindLabel[item.kind] || '')}` : ''}</div>`;
    peekEl.hidden = false;
    const r = devRect(el), W = device.offsetWidth, w = 300;
    const x = clamp((at ?? r.x + Math.min(r.w, 320) / 2) - w / 2, 8, W - w - 8);
    const below = r.y + r.h + 8, ph = peekEl.offsetHeight || 120;
    const y = below + ph > device.offsetHeight - 8 ? Math.max(8, r.y - ph - 8) : below;
    Object.assign(peekEl.style, { left: `${x}px`, top: `${y}px` });
    peekState = { id, el, via };
    el.classList.add('is-peeked');
    host.querySelector('.u-device').classList.add('is-dim');
    if (!reduced()) peekEl.animate(popKeys(0.96, 1), { duration: 150, easing: EASE });
    say(`${item?.title || id} 的概要`);
  }
  function hidePeek(instant = false) {
    if (!peekState) { unlink(); return; }
    const was = peekState;
    peekState = null;
    was.el.classList.remove('is-peeked');
    device.classList.remove('is-dim');
    unlink();
    if (instant || reduced()) { peekEl.hidden = true; return; }
    const a = peekEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: EASE });
    a.finished.then(() => { if (!peekState) peekEl.hidden = true; }).catch(() => {});
  }
  /** Long press on a run of the band: the stripe (or row) it belongs to is outlined, wherever it is on the spread. */
  const bandOf = () => (posture === 'table' ? tPin : bpin).querySelector('.u-band');
  /** Which item's run of the band lies under client x (null over the spare cells). */
  function bandHit(x) {
    const bandEl = bandOf();
    if (!bandEl) return null;
    const b = bandEl.getBoundingClientRect(), k = scale();
    const cellsAt = (x - b.left) / k / (posture === 'table' ? TCELL : G.cell);
    let hit = null;
    for (const node of bandEl.children) { const from = node.__from ?? 0, seg = latestSeg(node.dataset.seg); if (seg && cellsAt >= from && cellsAt < from + seg.share) hit = node.dataset.seg; }
    return hit && hit !== 'blank' ? hit : null;
  }
  function linkBand(hit) {
    const bandEl = bandOf();
    if (!bandEl || !hit) return null;
    linked = hit;
    for (const el of host.querySelectorAll(`[data-id="${CSS.escape(hit)}"]`)) if (el.matches(ITEMS)) el.classList.add('is-linked');
    for (const node of bandEl.children) node.classList.toggle('is-lit', node.dataset.seg === hit);
    return hit;
  }
  const latestSeg = id => { const sh = latest?.sh; if (!sh) return null; return [...sh.open, ...sh.pending, ...sh.agent].find(x => x.id === id) || null; };
  function unlink() {
    if (!linked) return;
    for (const el of host.querySelectorAll('.is-linked')) el.classList.remove('is-linked');
    for (const el of host.querySelectorAll('.u-band > .is-lit')) el.classList.remove('is-lit');
    linked = null;
  }

  // ---------- the detail: on the left page (book), the outer screen (closed), the top half (tabletop) ----------
  let detailCtx = null;
  const detail = { id: null, origin: null, mode: 'item', loose: null };
  /** Where the detail lies, and its corners: where it meets the screen's own corner it takes that corner's radius. */
  function panelRect() {
    const { inner: I, outer: O, table: T } = BODY.corners;
    if (posture === 'table') return { x: 0, y: 0, w: G.PH - G.rail, h: G.PW, r: radius([T.tl, 20, 20, 20]) };
    if (phase === 'book') return { x: 0, y: 0, w: G.PW - G.gap / 2 + 4, h: G.PH, r: radius([I.tl, 20, 20, I.bl]) };
    return { x: G.OX, y: 0, w: G.S - G.rail, h: G.L, r: radius([O.tl, 20, 20, O.bl]) };
  }
  const elOf = id => {
    const root = visibleLayer() === 'book' ? spread : visibleLayer() === 'table' ? table : outer;
    return root.querySelector(`[data-key="L:${CSS.escape(id)}"], [data-key="tL:${CSS.escape(id)}"], [data-key="ml:${CSS.escape(id)}"], [data-key="i:${CSS.escape(id)}"], [data-key="mr:${CSS.escape(id)}"], [data-key="tm:${CSS.escape(id)}"]`);
  };
  /**
   * Open a detail on the left page. mode 'feed': the round's inputs that made it, in full (a tap on a group of inputs, or on
   * a grey line); 'item': D's detail, why it is here and how it changed (a tap on a card's words, a row of 在办, or the
   * link at the foot of a feed). A group with no item (gone:<id>, fold:<disposition>:<source>) is held as `loose`, not selected.
   */
  function openDetail(id, origin, mode = 'item') {
    if (!id) return;
    detail.origin = origin || elOf(id); detail.mode = mode;
    if (!id.includes(':') && getItem(s.state, id)) { detail.loose = null; if (s.selectedId === id) renderDetail(); else model.select(id); return; }
    detail.loose = id; detail.mode = 'feed';
    if (s.selectedId) model.select(null); else renderDetail();
  }
  /** A group of this round's inputs by its key: an item (its card's group, or its line on the Agent's side), an item no
   * longer on the page (gone:<id>), or one grey line of what was folded (fold:<disposition>:<source>). */
  function feedGroup(key) {
    const c = census(compose());
    if (key === 'round') {
      // the whole round, from the outer screen's 累计 bar: every input in time order, each with where it went
      const v = compose(), asks = new Set(v.asks.map(x => x.id));
      const dest = g => { if (!g.target) return DISP_WORD[g.disp] || g.disp; const it = getItem(s.state, g.target) || s.records[s.index].snapshot.items[g.target]; return `${asks.has(g.target) ? '→ ' : '→ Agent 那边 · '}${it?.title || g.target}`; };
      return { title: `本轮 ${c.n} 条输入`, where: '本轮', sub: c.n ? `${c.mine} 条成了这 ${c.cards} 件 · ${c.agentN} 条进了 Agent 那边 · ${c.loose.length} 条折掉。翻开看它们各在哪一件旁边` : '这一轮没有新输入',
        gs: [...feed().plan.list].sort((a, b) => a.at - b.at), tone: '#9a958b', dest };
    }
    if (key.startsWith('fold:')) {
      const line = foldLines(c).find(x => x.key === key);
      return line && { title: `${DISP_WORD[line.disp] || line.disp} · ${line.src}`, where: '折掉的', sub: `${line.gs.length} 条，这一轮没有进任何一件`, gs: line.gs, tone: '#9a958b' };
    }
    const id = key.startsWith('gone:') ? key.slice(5) : key, item = getItem(s.state, id), stored = s.records[s.index].snapshot.items[id];
    if (!item && !stored) return null;
    const asks = new Set(compose().asks.map(x => x.id));
    return { item: key.startsWith('gone:') ? null : item, title: (item || stored).title, where: asks.has(id) ? '进了右页这张卡' : 'Agent 那边',
      sub: `本轮进了它 ${feedOf(id).length} 条`, gs: feedOf(id), tone: item ? colorFor(item, s.state) : '#9a958b' };
  }
  /** One input in full: who, where, when, its subject and its text (the data keeps up to 500 characters of it). */
  function rawHTML(g, tone, dest = null) {
    const e = s.frame.events[g.k], who = whoOf(e), own = who === '你';
    const initial = (own ? '你' : who).replace(/^[^\p{Script=Han}A-Za-z]+/u, '').slice(0, 1) || '·';
    const text = String(e.text || '').trim();
    const where = dest ? ` · ${dest(g)}` : g.disp !== 'used' ? ` · ${DISP_WORD[g.disp] || g.disp}` : '';
    return `<article class="d-source u-raw${g.disp !== 'used' ? ' is-fold' : ''}"><span class="d-avatar" style="--tone:${own ? '#55565c' : tone}">${esc(initial)}</span><div><small>${esc(own ? `你（${e.from}）` : who)} · ${esc(e.channel || '')} · ${stamp(g.at)}${esc(where)}</small>${e.subject ? `<b class="u-raw-s">${esc(e.subject)}</b>` : ''}${text ? `<p lang="${/[一-鿿]/.test(text) ? 'zh' : 'en'}">${esc(text)}</p>` : ''}</div></article>`;
  }
  function feedParts(key) {
    const grp = feedGroup(key);
    const bar = `<button data-d="back" aria-label="返回">‹</button><span>${esc(grp.where)}</span><span class="d-detail-share">${grp.gs.length} 条</span>`;
    const body = `<p class="d-meta"><span class="d-exp">本轮原文</span> · <span>${windowWords()}</span></p><h2>${esc(grp.title)}</h2><p class="d-detail-title">${esc(grp.sub)}</p>
      ${grp.gs.length ? `<section class="u-raws">${grp.gs.map(g => rawHTML(g, grp.tone, grp.dest)).join('')}</section>` : '<p class="d-small">这一轮没有输入进了它。</p>'}
      ${grp.item ? '<button type="button" class="d-link u-why" data-d="why">它为什么在这里、怎么变到现在 ›</button>' : ''}`;
    return { bar, body, actions: '' };
  }
  function renderDetail() {
    const sel = s.selectedId, item = sel && getItem(s.state, sel);
    const key = item ? sel : detail.loose, mode = item ? detail.mode : 'feed';
    if (!key || (mode === 'feed' && !feedGroup(key))) { if (detail.id) closePanel(); return; }
    const parts = mode === 'feed' ? feedParts(key) : detailParts(item);
    // On the spread the right half keeps the controls; the panel carries them only for what has no right half.
    const hasHalf = Boolean(spread.querySelector(`[data-key="R:${CSS.escape(key)}"], [data-key="mr:${CSS.escape(key)}"]`)) && visibleLayer() !== 'outer';
    const actions = mode === 'feed' || hasHalf ? '' : parts.actions;
    const fill = () => {
      panel.querySelector('.d-detail-bar').innerHTML = parts.bar;
      panel.querySelector('.d-detail-body').innerHTML = parts.body;
      const act = panel.querySelector('.d-detail-actions');
      act.innerHTML = actions; act.hidden = !actions;
      panel.dataset.mode = mode;
    };
    if (detail.id === key) {
      // the same thing again (a beat redrew the page): keep the place you read to; from its inputs to its story: from the top
      const body = panel.querySelector('.d-detail-body'), turned = panel.dataset.mode !== mode, top = turned ? 0 : body.scrollTop;
      fill(); body.scrollTop = top;
      if (turned && !reduced()) panel.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 180, easing: EASE });
      return;
    }
    const switching = Boolean(detail.id) && !panel.hidden;
    // where the detail grows from, read before the panel is filled (a read after it would lay the page out again)
    const from = detail.origin?.isConnected ? detail.origin : elOf(key), originRect = !switching && from ? devRect(from) : null;
    detail.id = key;
    fill();
    markOpen(key);
    if (switching) { if (!reduced()) panel.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 180, easing: EASE }); return; }
    openPanel(originRect);
  }
  function markOpen(id) {
    for (const el of host.querySelectorAll('.is-open')) el.classList.remove('is-open');
    if (id) for (const el of host.querySelectorAll(`[data-feed="${CSS.escape(id)}"]`)) el.classList.add('is-open');
    if (id) for (const el of host.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)) if (el.matches(ITEMS)) el.classList.add('is-open');
    device.classList.toggle('is-detail', Boolean(id));
  }
  function openPanel(originRect = null) {
    settle(detailCtx);
    hidePeek(true);
    const r = panelRect();
    Object.assign(panel.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, borderRadius: r.r });
    panel.hidden = false;
    panel.classList.remove('is-leaving');
    const origin = detail.origin?.isConnected ? detail.origin : elOf(detail.id);
    const back = () => panel.querySelector('[data-d="back"]')?.focus({ preventScroll: true });
    if (reduced() || !origin) { panel.classList.remove('is-growing'); back(); return; }
    const ctx = newCtx();
    detailCtx = ctx;
    panel.classList.add('is-growing');
    const o = originRect || devRect(origin);
    // the growing box rides in a host clipped to the screen's shape, so its square-ish corners never cross the bezel
    const box = makeBox(clipEl, { bg: 'var(--paper)', r: 20 }, Math.max(o.w, r.w));
    box.el.classList.add('u-detail-box');
    box.animate(ctx, o, o, DETAIL.pop);
    box.animate(ctx, o, r, DETAIL.frame);
    ctx.clean(() => box.remove());
    play(ctx, panel, [{ opacity: 0 }, { opacity: 1 }], DETAIL.content, { easing: 'linear' });
    play(ctx, origin, popKeys(1, 1.02, 6), DETAIL.pop);
    arm(ctx, () => { if (detailCtx === ctx) detailCtx = null; panel.classList.remove('is-growing'); });
    back();
  }
  function closePanel() {
    const id = detail.id, origin = detail.origin?.isConnected ? detail.origin : elOf(id);
    detail.id = null; detail.origin = null; detail.loose = null; detail.mode = 'item';
    markOpen(null);
    settle(detailCtx);
    if (panel.hidden) return;
    const done = () => { panel.hidden = true; panel.classList.remove('is-leaving', 'is-growing'); };
    const focusBack = () => { if (origin?.isConnected && panel.contains(document.activeElement)) origin.focus({ preventScroll: true }); else if (origin?.isConnected && !host.contains(document.activeElement)) origin.focus({ preventScroll: true }); };
    focusBack();
    if (detail.pulled) {
      // pulled down past the line: it goes on down from where the finger left it and fades (no box back to the row)
      detail.pulled = false;
      const from = { transform: panel.style.transform || 'none', opacity: Number(panel.style.opacity || 1) }, y = parseFloat(from.transform.replace(/^translateY\(/, '')) || 0;
      panel.style.transform = ''; panel.style.opacity = '';
      if (reduced()) { done(); return; }
      const ctx = newCtx();
      detailCtx = ctx;
      panel.classList.add('is-leaving');
      play(ctx, panel, [from, { transform: `translateY(${y + 32}px)`, opacity: 0 }], [0, 0.16], { easing: EASE_IN });
      arm(ctx, () => { if (detailCtx === ctx) detailCtx = null; done(); });
      return;
    }
    if (reduced() || !origin) { done(); return; }
    const ctx = newCtx();
    detailCtx = ctx;
    panel.classList.add('is-leaving');
    const r = panelRect(), o = devRect(origin);
    // the list was scrolled while the detail was open and its row is under the pinned head or past the foot: nothing to
    // shrink back into, the detail just fades (a box going in under the head would cross it)
    const list = origin.closest('.u-iscroll, .u-oscroll, .u-tscroll, .u-bot'), view = list && devRect(list);
    if (view && (o.y + o.h < view.y + 12 || o.y > view.y + view.h - 12)) {
      play(ctx, panel, [{ opacity: 1 }, { opacity: 0 }], [0, UNDETAIL.total * 0.6], { easing: 'linear' });
      arm(ctx, () => { if (detailCtx === ctx) detailCtx = null; done(); });
      return;
    }
    const box = makeBox(clipEl, { bg: 'var(--paper)', r: 20 }, Math.max(o.w, r.w));
    box.el.classList.add('u-detail-box');
    box.animate(ctx, r, o, UNDETAIL.frame);
    play(ctx, box.el, [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], UNDETAIL.frame, { easing: 'linear' });
    ctx.clean(() => box.remove());
    play(ctx, panel, [{ opacity: 1 }, { opacity: 0 }], UNDETAIL.content, { easing: 'linear' });
    arm(ctx, () => { if (detailCtx === ctx) detailCtx = null; done(); });
  }
  const closeDetail = () => { if (s.selectedId) model.select(null); else if (detail.id) closePanel(); };
  /**
   * Pull the detail down while its body is at its top (D's gesture, plainer): it follows the finger down and fades; let go
   * past a quarter of its height, or quickly, and it closes; short of that it goes back up in 0.20 s. Touch only.
   */
  let pull = null;
  panel.addEventListener('touchstart', e => {
    const body = panel.querySelector('.d-detail-body');
    if (e.touches.length !== 1 || panel.hidden || panel.classList.contains('is-leaving') || e.target.closest('textarea, input, .d-keypad')) { pull = null; return; }
    pull = { x: e.touches[0].clientX, y: e.touches[0].clientY, top: body.scrollTop <= 0 || !body.contains(e.target), on: false, dy: 0, samples: [] };
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (!pull) return;
    const dx = e.touches[0].clientX - pull.x, dy = e.touches[0].clientY - pull.y;
    if (!pull.on) {
      // down from the top is ours from the first pixel (so the list does not start its own bounce); anything else scrolls
      if (!pull.top || dy < 0 || Math.abs(dx) > Math.abs(dy)) { if (Math.abs(dx) > 8 || dy < -2) pull = null; return; }
      if (e.cancelable) e.preventDefault();
      if (dy < 8 || reduced()) return;
      pull.on = true; settle(detailCtx);
    }
    if (e.cancelable) e.preventDefault();
    pull.dy = dy; pull.samples.push([performance.now(), dy]); if (pull.samples.length > 6) pull.samples.shift();
    const d = (dy - 8) / scale();
    panel.style.transform = `translateY(${(d * 0.6).toFixed(1)}px)`;
    panel.style.opacity = (1 - 0.6 * clamp(d / panel.offsetHeight, 0, 1)).toFixed(3);
  }, { passive: false });
  const endPull = () => {
    const p = pull;
    pull = null;
    if (!p?.on) return;
    const [t0, y0] = p.samples[0] || [0, 0], [t1, y1] = p.samples.at(-1) || [1, 0], v = (y1 - y0) / Math.max(1, t1 - t0);
    if (p.dy / scale() > panel.offsetHeight / 4 || v > 0.5) { detail.pulled = true; closeDetail(); return; }
    const from = { transform: panel.style.transform, opacity: Number(panel.style.opacity || 1) };
    panel.style.transform = ''; panel.style.opacity = '';
    panel.animate([from, { transform: 'none', opacity: 1 }], { duration: 200, easing: EASE });
  };
  panel.addEventListener('touchend', endPull);
  panel.addEventListener('touchcancel', endPull);

  // ---------- sheets (D's): the snooze options, the compact chip's controls, a reply, an amount, a time ----------
  let sheetReturn = null;
  function openSheet(html, label = '操作') {
    hidePeek(true);
    const { inner: I, outer: O, table: T } = BODY.corners;
    const r = posture === 'table' ? { x: 0, y: G.PW, w: G.PH, h: G.PW, r: radius([0, 0, T.br, T.bl]) } : phase === 'book' ? { x: G.PW, y: 0, w: G.PW, h: G.PH, r: radius([0, I.tr, I.br, 0]) } : { x: G.OX, y: 0, w: G.S, h: G.L, r: radius([O.tl, O.tr, O.br, O.bl]) };
    Object.assign(sheetHost.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, borderRadius: r.r });
    if (sheet.hidden) sheetReturn = document.activeElement;
    sheet.setAttribute('aria-label', label);
    sheet.innerHTML = `<div class="d-sheet-grip" aria-hidden="true"></div>${html}`;
    const was = sheet.hidden;
    sheet.hidden = false; backdrop.hidden = false; sheetHost.classList.add('is-on');
    if (was && !reduced()) { sheet.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 300, easing: EASE }); backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 }); }
    sheet.querySelector('textarea, .d-sheet-options button, button:not(.d-sheet-grip)')?.focus({ preventScroll: true });
  }
  function closeSheet({ refocus = true } = {}) {
    if (sheet.hidden) return;
    sheet.hidden = true; backdrop.hidden = true; sheetHost.classList.remove('is-on');
    if (refocus && sheetReturn?.isConnected) sheetReturn.focus({ preventScroll: true });
    sheetReturn = null;
  }
  /**
   * 记录 on the system strip: D's 我的回应记录, newest first — what you answered on this page (撤回 still works from here)
   * and what the story says you did at the source (↩). A 稍后 shows here too, which is how a deferred thing is found in E.
   */
  function logSheet() {
    const verb = f => (f.meaning === 'ack' ? '已阅' : f.meaning === 'decide' ? `选了「${f.label}」` : f.meaning === 'input' ? `提交「${f.value ?? f.label}」` : f.meaning === 'act' ? `报告「${f.label}」` : `${clock(f.until)} 再提醒`);
    const entries = responses.list(s.cursor).map(f => ({ at: f.at, title: f.title, text: verb(f), id: f.item, key: f.key, status: responseStatus(f, s.frames, s.cursor), local: true }));
    s.frames.slice(0, s.index + 1).forEach((frame, i) => frame.events.forEach(e => (e.feedback || []).forEach(link => entries.push({ at: Date.parse(e.at), title: getItem(s.state, link.target)?.title || getItem(s.records[i].state, link.target)?.title || link.target, text: actionWords(e, link, view.askAt(i, link.target)), id: link.target, story: true }))));
    entries.sort((a, b) => b.at - a.at);
    openSheet(`<h3>我的回应记录</h3><p class="d-small">按时间倒序。本页点按的只留在演示里；故事里你在原处或回复 Agent 的，标 ↩。</p><ul class="d-fold-list d-log">${entries.slice(0, 80).map(e => `<li><small>${stamp(e.at)}${e.story ? ' · ↩ 故事' : ` · 本页 · ${e.status.status === 'acknowledged' ? '已收到' : '已保存'}`}</small><p><b>${esc(e.title)}</b>${esc(e.text)}</p>${e.local ? `<button type="button" class="d-link" data-undo-key="${esc(e.key)}">撤回</button>` : ''}${getItem(s.state, e.id) ? `<button type="button" class="d-link is-quiet" data-open="${esc(e.id)}">看这件事</button>` : ''}</li>`).join('') || '<li><p>还没有回应过任何事。</p></li>'}</ul>`, '我的回应记录');
  }
  const askAction = key => { const [id, aid] = key.split(':'); const item = getItem(s.state, id), ask = currentAsk(s, id); return { item, ask, action: normalizeAsk(ask)?.actions.find(a => a.id === aid) }; };
  const sheets = {
    actions: id => { const item = getItem(s.state, id), ask = currentAsk(s, id); openSheet(`<p class="d-sheet-kicker">${dot(colorFor(item, s.state))}${esc(item.title)}</p><h3>${esc(ask?.prompt || item.title)}</h3><p class="d-small">${esc(item.summary)}</p>${ask ? answerHTML(item, ask, { inDetail: true }) : ''}`, ask?.prompt || item.title); },
    defer: id => { const item = getItem(s.state, id); openSheet(`<h3>什么时候再提醒？</h3><p class="d-small">「${esc(item.title)}」<br>稍后提醒不是已阅，也不改原截止时间。</p>${deferHTML({ target: id, now: s.cursor, classes: RS })}`, '稍后提醒'); },
    compose: key => { const { ask, action } = askAction(key); openSheet(`<h3>${esc(action.label)}</h3><p class="d-small">${esc(ask.prompt)}</p>${composerHTML({ ...action, input: { placeholder: '写一句，Agent 下一轮整理时带上', ...action.input } }, { key, classes: RS })}`, action.label); },
    keypad: key => { const { item, action } = askAction(key); openSheet(`<h3>${esc(action.label)}</h3><p class="d-small">${esc(item.title)}</p>${keypadHTML(action, { key, value: drafts.get(key) ?? action.input.prefill, classes: RS })}`, action.label); },
    schedule: key => { const { ask, action } = askAction(key); openSheet(`<h3>${esc(action.label)}</h3><p class="d-small">${esc(ask.prompt)}</p>${scheduleHTML(action, { key, now: s.cursor, classes: RS })}`, action.label); },
  };

  // ---------- answering ----------
  function give(item, action, value, until) {
    if (!item) return;
    if (s.playing && action.meaning !== 'ack') model.pause();
    const record = responses.save(item, action, { ask: currentAsk(s, item.id), value, until, at: s.cursor });
    say(record.meaning === 'ack' || record.meaning === 'snooze' ? answerWords(record) : `已保存 · ${answerWords(record, currentAsk(s, item.id))}`);
    const name = record.meaning === 'snooze' || record.meaning === 'ack' ? 'local' : 'answer';
    // what was below (beside, on the tabletop) closes up under the finger that just pressed: guard it, as D does
    if (name === 'answer' && lastDown && performance.now() - lastDown.t < 900) guard = { x: lastDown.x, y: lastDown.y, id: item.id, until: performance.now() + BOOK.answer.guard * 1000 };
    render(name, { target: item.id });
    // focus on 撤回, under the finger
    const root = visibleLayer() === 'book' ? spread : visibleLayer() === 'table' ? table : outer;
    root.querySelector(`[data-id="${CSS.escape(item.id)}"] [data-rs-undo]`)?.focus({ preventScroll: true });
  }
  const ACK = { id: 'ack', label: '已阅', meaning: 'ack' };
  const unbindResponses = bindResponses(host, {
    drafts,
    ask: id => currentAsk(s, id),
    respond(target, action, { value, until } = {}) {
      endTellOnInput();
      closeSheet({ refocus: false });
      give(getItem(s.state, target), action, value, until);
    },
    open(kind, key) { endTellOnInput(); sheets[kind]?.(key); },
    undo(target) {
      endTellOnInput();
      closeSheet({ refocus: false });
      const item = getItem(s.state, target);
      if (!item) return;
      const record = answeredRecord(item) || recordOf(item);
      if (record) responses.removeKey(record.key);
      say('已撤回');
      render('undo', { target });
      const root = visibleLayer() === 'book' ? spread : visibleLayer() === 'table' ? table : outer;
      root.querySelector(`[data-id="${CSS.escape(target)}"] [data-rs-act]`)?.focus({ preventScroll: true });
    },
  });

  // Finger guard (D's): for a moment after an answer, the stripes below (the columns beside, on the tabletop) close up under
  // the finger that pressed; a tap there in that time does not land on what slid under it. Your own receipt is yours to tap.
  let lastDown = null, guard = null;
  host.addEventListener('pointerdown', event => { lastDown = { x: event.clientX, y: event.clientY, t: performance.now() }; }, true);
  host.addEventListener('click', event => {
    if (!guard || event.detail === 0) return;
    if (performance.now() > guard.until) { guard = null; return; }
    if (Math.hypot(event.clientX - guard.x, event.clientY - guard.y) > 32) return;
    if (event.target.closest(ITEMS)?.dataset.id === guard.id) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  }, true);

  // ---------- pointer: tap, long press, the hinge handle ----------
  let press = null, pressHeld = false, swallowUntil = 0, drag = null, pan = null, creaseAt = -1e9;
  const cancelPress = () => { if (!press) return; clearTimeout(press.hint); clearTimeout(press.fire); press.el.classList.remove('is-pressing'); press = null; };
  /**
   * The folding region (HIG): a strip either side of the crease, as wide as the paper between the two halves (24 pt; 48 pt
   * half-folded); on the tabletop it runs across. Nothing there answers a tap or a press, not even as a tap on blank: a
   * thumb resting on the fold is not a request. The hinge handle in the browser, the detail, a sheet and a summary card that
   * reach into it are theirs, not the fold's.
   */
  function inCrease(event) {
    const t = event.target;
    if (!device.contains(t) || visibleLayer() === 'outer' || t.closest('.u-grip, .u-ldetail, .u-sheethost, .d-peek')) return false;
    const d = device.getBoundingClientRect(), k = scale();
    if (posture === 'table') return Math.abs((event.clientY - d.top) / k - G.PW) < G.gap / 2;
    return Math.abs((event.clientX - d.left) / k - G.crease) < (book.classList.contains('is-half') ? 48 : G.gap) / 2;
  }
  function onDown(event) {
    endTellOnInput();
    if (event.button > 0) return;
    if (event.target.closest('.u-grip')) {
      hingeTween?.cancel();
      drag = { x: event.clientX, a: angle, moved: false, id: event.pointerId };
      grip.setPointerCapture?.(event.pointerId);
      grip.classList.add('is-dragging');
      event.preventDefault();
      return;
    }
    // Half-folded, the left page is the resting panel, not a list: a finger dragged on it scrolls the book (both pages).
    if (event.pointerType !== 'mouse' && event.target.closest('.u-fold3d.is-live')) pan = { y: event.clientY, s: iscroll.scrollTop, id: event.pointerId, on: false };
    // a touch on the folding region does nothing, and neither does the click that follows it, wherever the browser moves
    // that click to (a touch is adjusted toward the nearest thing that takes taps: here the group beside the crease)
    creaseAt = inCrease(event) ? performance.now() : -1e9;
    if (creaseAt > 0) return;
    // a row of 在办 (D's): swiped left past 80 pt it says “知道了”
    const row = event.target.closest('[data-swipe]');
    if (row && device.contains(row) && !event.target.closest('button')) swipe = { el: row, x: event.clientX, y: event.clientY, id: row.dataset.swipe, dx: 0, pid: event.pointerId };
    if (event.target.closest(`${RS_CONTROLS}, .u-ldetail, .d-sheet, .d-peek, button, a, textarea, input`) && !event.target.closest('.u-bandrow')) return;
    const el = event.target.closest(PRESSABLE);
    if (!el || !device.contains(el)) return;
    press = { el, x: event.clientX, y: event.clientY, t: performance.now() };
    press.hint = setTimeout(() => press?.el.classList.add('is-pressing'), PRESS.hint * 1000);
    press.fire = setTimeout(() => {
      if (!press) return;
      const { el: target, x } = press;
      cancelPress();
      pressHeld = true;
      if (s.playing) model.pause();
      if (target.matches('.u-bandrow, .u-tband')) { const id = bandHit(x); if (id) { showPeek(id, target, 'press', (x - device.getBoundingClientRect().left) / scale()); linkBand(id); } return; }
      const id = target.dataset.id || (target.matches('.u-ledger, .d-fold') ? null : null);
      if (id) showPeek(id, target, 'press');
    }, PRESS.hold * 1000);
  }
  function onMove(event) {
    if (drag && event.pointerId === drag.id) {
      const dx = (event.clientX - drag.x) / scale();
      if (Math.abs(dx) > 3) drag.moved = true;
      if (drag.moved) setAngle(drag.a - (dx / G.PW) * 180);
      return;
    }
    if (pan && event.pointerId === pan.id) {
      const dy = event.clientY - pan.y;
      if (!pan.on && Math.abs(dy) > PRESS.slop) { pan.on = true; cancelPress(); }
      if (pan.on) { iscroll.scrollTop = pan.s - dy / scale(); return; }
    }
    if (swipe && event.pointerId === swipe.pid) {
      const dx = Math.min(0, event.clientX - swipe.x) / scale();
      if (!swipe.active && Math.abs(event.clientY - swipe.y) > 8) swipe = null;
      else {
        if (!swipe.active && dx < -8) { swipe.active = true; cancelPress(); swipe.el.setPointerCapture?.(event.pointerId); swipe.hint = swipeHint(swipe.el); }
        if (swipe.active) {
          swipe.dx = dx;
          swipe.el.style.transform = `translateX(${dx}px)`;
          // the words it will say stay where the row's right edge was, uncovered as it moves; past 80 pt they turn ink
          swipe.hint.style.transform = `translateX(${-dx}px)`;
          swipe.hint.style.opacity = clamp(-dx / 80, 0, 1).toFixed(2);
          swipe.hint.classList.toggle('is-armed', dx < -80);
          return;
        }
      }
    }
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS.slop) cancelPress();
  }
  let swipe = null;
  function swipeHint(row) {
    const h = document.createElement('span');
    h.className = 'd-swipe-hint'; h.setAttribute('aria-hidden', 'true'); h.textContent = '✓ 知道了'; h.style.opacity = '0';
    row.append(h);
    return h;
  }
  /** Let go of a swiped row: past 80 pt it is known (D's 知道了); short of that it goes back in 0.20 s from where it was left. */
  function endSwipe() {
    const sw = swipe;
    swipe = null;
    if (!sw?.active) return;
    swallowUntil = performance.now() + 150;
    sw.el.style.transform = '';
    if (sw.dx < -80) { sw.hint.remove(); give(getItem(s.state, sw.id), ACK); return; }
    if (reduced()) { sw.hint.remove(); return; }
    sw.el.animate([{ transform: `translateX(${sw.dx}px)` }, { transform: 'none' }], { duration: 200, easing: EASE });
    const a = sw.hint.animate([{ transform: `translateX(${-sw.dx}px)`, opacity: Number(sw.hint.style.opacity) }, { transform: 'none', opacity: 0 }], { duration: 200, easing: EASE, fill: 'forwards' });
    a.onfinish = a.oncancel = () => sw.hint.remove();
  }
  function onUp(event) {
    if (pan && event.pointerId === pan.id) { if (pan.on) swallowUntil = performance.now() + 150; pan = null; }
    if (swipe && event.pointerId === swipe.pid) endSwipe();
    if (drag && event.pointerId === drag.id) {
      grip.classList.remove('is-dragging');
      const moved = drag.moved;
      drag = null;
      swallowUntil = performance.now() + 150;
      if (!moved) { tweenTo(phase === 'book' ? 0 : 180); return; }
      tweenTo(angle >= 90 ? 180 : 0);
      return;
    }
    cancelPress();
    if (pressHeld) { pressHeld = false; swallowUntil = performance.now() + 150; }
  }
  function onClick(event) {
    if (performance.now() < swallowUntil) { event.preventDefault(); event.stopPropagation(); return; }
    const t = event.target;
    if (inCrease(event) || performance.now() - creaseAt < 800) { creaseAt = -1e9; event.preventDefault(); return; }
    if (t.closest(RS_CONTROLS)) return;
    const u = t.closest('[data-u]')?.dataset.u;
    if (u) { railAction(u); return; }
    const p = t.closest('[data-posture]')?.dataset.posture;
    if (p) { endTellOnInput(); setPosture(p); return; }
    if (t === backdrop) { closeSheet(); return; }
    if (!device.contains(t)) return;
    // inside 我的回应记录: 撤回 reads the log again; 看这件事 puts the sheet away and opens that thing's story
    if (t.closest('.d-log')) {
      const undo = t.closest('[data-undo-key]')?.dataset.undoKey, see = t.closest('[data-open]')?.dataset.open;
      if (undo) { responses.removeKey(undo); render('local'); logSheet(); }
      else if (see) { closeSheet({ refocus: false }); openDetail(see, elOf(see)); }
      return;
    }
    if (peekState) {
      if (t.closest('.u-peek')) { const id = peekState.id, origin = peekState.el; hidePeek(true); openDetail(id, origin.matches('.u-bandrow') ? elOf(id) : origin); return; }
      hidePeek(); event.preventDefault(); return;
    }
    const d = t.closest('[data-d]')?.dataset.d;
    if (d === 'back') { closeDetail(); return; }
    if (d === 'why') { detail.mode = 'item'; renderDetail(); return; } // from a card's inputs to its story, in the same panel
    if (d === 'more') { open.more = !open.more; render('local'); return; }
    if (d === 'tail') { open.tail = !open.tail; render('local'); return; }
    if (d === 'surface') { surface = surface === 'focus' ? 'inbox' : 'focus'; render('local'); return; }
    const ack = t.closest('[data-ack]')?.dataset.ack;
    if (ack) { give(getItem(s.state, ack), ACK); return; }
    const many = t.closest('[data-ack-many]')?.dataset.ackMany;
    if (many) { for (const id of many.split(',')) responses.save(getItem(s.state, id), ACK, { at: s.cursor }); render('local'); return; }
    const undoKey = t.closest('[data-undo-key]')?.dataset.undoKey;
    if (undoKey) { responses.removeKey(undoKey); render('local'); return; }
    if (t.closest('.u-ldetail')) { const child = t.closest('[data-open]'); if (child) openDetail(child.dataset.open, null); return; }
    const openLink = t.closest('[data-open]');
    if (openLink) { openDetail(openLink.dataset.open, openLink.closest(ITEMS)); return; }
    // a grey line of what was folded, or a line on the Agent's side: the originals of those inputs (again: closed)
    const line = t.closest('[data-feed]');
    if (line) { if (detail.id === line.dataset.feed && !panel.hidden) closeDetail(); else openDetail(line.dataset.feed, line, 'feed'); return; }
    const item = t.closest(ITEMS);
    // An answered right half is your receipt: only 撤回 on it acts (a second tap where the button was does nothing).
    if (item?.matches('.u-half.is-answered')) return;
    if (item?.dataset.id && !t.closest('.d-sheet')) {
      if (s.selectedId === item.dataset.id && item.matches('.u-half.is-left, .u-mini.is-left')) { closeDetail(); return; }
      // A group of inputs opens its originals; a tap on the right half's own words opens the card's story (D's detail),
      // grown from the group beside it; its buttons answer (bindResponses).
      const right = item.matches('.u-half.is-right');
      openDetail(item.dataset.id, right ? (spread.querySelector(`[data-key="L:${CSS.escape(item.dataset.id)}"]`) || item) : item, item.matches('.is-feed') ? 'feed' : 'item');
      return;
    }
    if ((s.selectedId || detail.loose) && !t.closest('.u-ldetail')) closeDetail();
  }
  function railAction(u) {
    endTellOnInput();
    if (u === 'prev') model.goFrame(s.index - 1);
    else if (u === 'next') model.goFrame(s.index + 1);
    else if (u === 'play') model.togglePlay();
    else if (u === 'reset') { for (const r of responses.list(Infinity)) responses.removeKey(r.key); render('local'); }
    else if (u === 'replay') startTell(true);
    else if (u === 'log') logSheet();
    // the outer screen's 累计 bar: this round's inputs, each with where it went (what the book lays open, one screen at a time)
    else if (u === 'fold') { if (detail.id === 'round' && !panel.hidden) closeDetail(); else openDetail('round', outer.querySelector('.u-ofold'), 'feed'); }
  }
  track.addEventListener('pointerdown', event => {
    const pick = e => { const r = track.getBoundingClientRect(); model.goFrame(Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * (s.frames.length - 1))); };
    pick(event);
  });
  host.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  host.addEventListener('click', onClick);
  /**
   * A wheel over a screen scrolls that screen's list, wherever on the screen it is: over a list (or the detail's body, or
   * a sheet) natively, and that list keeps the rest (overscroll-behavior: contain); over a pinned head, the rail, the fold
   * or the resting panel, the list under it. Nothing in the device hands a wheel on to the page.
   */
  device.addEventListener('wheel', event => {
    if (event.ctrlKey || event.target.closest('.u-iscroll, .u-oscroll, .u-tscroll, .u-bot, .u-tcols, .d-detail-body, .d-sheet')) return;
    event.preventDefault();
    const d = device.getBoundingClientRect(), layer = visibleLayer();
    // sideways over the tabletop's head or rail: the strip of columns (both halves together)
    if (layer === 'table' && !event.target.closest('.u-ldetail') && Math.abs(event.deltaX) > Math.abs(event.deltaY)) { tCols.scrollLeft += event.deltaMode === 1 ? event.deltaX * 16 : event.deltaX; return; }
    const list = event.target.closest('.u-ldetail')?.querySelector('.d-detail-body')
      || (layer === 'table' ? ((event.clientY - d.top) / scale() < G.PW ? tScroll : tBot) : scrollerOf(layer));
    const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * list.clientHeight : event.deltaY;
    list.scrollTop += dy;
  }, { passive: false });
  // A list that scrolls drops a press in progress and a pressed summary (it was placed by the row that just moved).
  const scrolled = () => { cancelPress(); if (peekState?.via === 'press') hidePeek(true); };
  iscroll.addEventListener('scroll', () => {
    scrolled(); edgeOf(iscroll);
    // the panel's picture of the left page scrolls with the spread (both pages scroll as one), under its pinned head
    if (fold.ok && phase === 'book' && fold.scroll !== iscroll.scrollTop) panelScroll();
  }, { passive: true });
  oscroll.addEventListener('scroll', () => {
    scrolled(); edgeOf(oscroll);
    // the panel's picture of the outer screen is out of step: opening, the left page follows it at once (the outer screen
    // is the right page then); closed, the picture catches up as it lifts
    if (!fold.ok || oscroll.scrollTop === fold.os) return;
    fold.dirty = true;
    if (panelUp() && phase !== 'book') panelScroll(); else catchUp();
  }, { passive: true });
  // closed, the book (hidden) and the picture catch up once the outer screen has stopped, while nothing else is going on,
  // so the first frame of the next turn has no layout to read
  let catchTimer = 0;
  function catchUp() {
    clearTimeout(catchTimer);
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 0));
    catchTimer = setTimeout(() => idle(() => { if (!disposed && fold.ok && fold.dirty && !panelUp() && !press && !drag && !peekState) panelScroll(); }, { timeout: 600 }), 250);
  }
  for (const el of [tScroll, tBot]) el.addEventListener('scroll', () => { scrolled(); apartTable(); }, { passive: true });
  tCols.addEventListener('scroll', () => { scrolled(); stripEdges(); }, { passive: true });
  // keyboard focus on a row shows its summary, as a long press does
  host.addEventListener('focusin', event => {
    const el = event.target;
    if (!device.contains(el) || !el.matches?.('.u-mini, .d-line, .d-tail-item, .d-ask-row')) return;
    if (el.dataset.id && peekState?.id !== el.dataset.id) showPeek(el.dataset.id, el, 'focus');
  });
  host.addEventListener('focusout', event => { if (peekState?.via === 'focus' && !host.contains(event.relatedTarget)) hidePeek(); });
  function onKey(event) {
    if (tell.running) { event.preventDefault(); event.stopPropagation(); skipTell(); return; }
    if (event.target.matches?.('input, textarea, select, [contenteditable]')) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') {
      if (!sheet.hidden) { closeSheet(); return; }
      if (s.selectedId || detail.id) { closeDetail(); return; }
      if (peekState) { const el = peekState.el; hidePeek(); if (el?.isConnected && peekState?.via !== 'focus') el.focus?.({ preventScroll: true }); }
      return;
    }
    if (event.key === '[' || event.key === ']') { event.preventDefault(); if (posture === 'table') setPosture('book'); else { hingeTween?.cancel(); setAngle(angle + (event.key === ']' ? 15 : -15)); } return; }
    if (event.key === 'f' || event.key === 'F') { event.preventDefault(); if (posture === 'table') setPosture('book'); else tweenTo(phase === 'book' ? 0 : 180); return; }
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.(ITEMS) && device.contains(event.target)) {
      event.preventDefault(); event.stopPropagation();
      openDetail(event.target.dataset.id, event.target, event.target.matches('.is-feed') ? 'feed' : 'item');
    }
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { hidePeek(true); }
  }
  document.addEventListener('keydown', onKey, true);
  grip.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); hingeTween?.cancel(); setAngle(angle + (event.key === 'ArrowLeft' ? 15 : -15)); }
  });

  // ---------- the tell: closed → open → answer one → the next round lands → closed ----------
  const tell = { running: false, done: false, timers: [] };
  function startTell(replay = false) {
    stopTell();
    if (reduced()) return;
    if (replay) for (const r of responses.list(Infinity)) responses.removeKey(r.key);
    tell.running = true; tell.done = false;
    const plan = TELL[dataset];
    hingeTween?.cancel();
    if (posture === 'table') { posture = 'book'; }
    phase = 'closed'; angle = 0;
    model.goFrame(frameIndex(plan.start));
    render('none'); showLayers();
    // the tell reads both screens from their tops (a replay after you scrolled starts there too)
    carried = null; setScroll(oscroll, 0); setScroll(iscroll, 0);
    buildPanel(); // the picture of both screens, taken while nothing moves (the turn starts in 0.9 s)
    let t = 0;
    const at = (dt, fn) => { t += dt; tell.timers.push(setTimeout(() => { if (tell.running) fn(); }, t * 1000)); };
    at(0.9, () => tweenTo(180, HAND.open, HAND.ease));
    at(HAND.open + 0.4 + 1.6, () => answerItem(planItem(), false, plan.action));
    at(2.0, () => model.goFrame(frameIndex(plan.next)));
    at(2.8, () => tweenTo(0, HAND.close, HAND.ease));
    at(HAND.close + 0.6, () => { tell.running = false; tell.done = true; renderRail(); });
    renderRail();
  }
  function stopTell() { for (const id of tell.timers) clearTimeout(id); tell.timers = []; tell.running = false; }
  /** Any key or press: the tell jumps to where it ends (closed, on the next round, the answer given). */
  function skipTell() {
    if (!tell.running) return;
    const plan = TELL[dataset];
    stopTell();
    hingeTween?.cancel();
    finishAll();
    if (s.index === frameIndex(plan.start)) { const id = planItem(); if (id && !answeredRecord(getItem(s.state, id))) answerItem(id, true, plan.action); }
    if (s.frame.id !== plan.next) model.goFrame(frameIndex(plan.next));
    finishAll();
    phase = 'closed'; angle = 0;
    showLayers();
    render('none');
    tell.done = true;
    renderRail();
  }
  function endTellOnInput() { if (tell.running) skipTell(); }
  const topId = () => (latest?.v.zone.find(({ item }) => !answeredRecord(item))?.item.id) || null;
  /** The tell answers its sample (the same one D and A use for the round) when it is open, else the first open stripe. */
  const planItem = () => (currentAsk(s, TELL[dataset].item) && getItem(s.state, TELL[dataset].item) ? TELL[dataset].item : topId());
  function answerItem(id, quiet = false, actionId = null) {
    const item = getItem(s.state, id), ask = item && currentAsk(s, id);
    if (!ask) return null;
    const n = normalizeAsk(ask);
    const action = n.actions.find(a => a.id === actionId) || n.actions.find(a => a.recommended) || n.actions.find(a => a.meaning === 'decide' || a.meaning === 'act') || n.actions[0];
    if (quiet) { responses.save(item, action, { ask, at: s.cursor }); return action.label; }
    give(item, action);
    return action.label;
  }

  // ---------- the round ----------
  const unsubscribe = model.subscribe((next, info) => {
    if (info.type === 'init') return;
    s = next; view.sync(next);
    if (info.type === 'frame' && next.index !== lastIndex) {
      turnPending = true;
      closeSheet({ refocus: false }); hidePeek(true);
      open.more = false; open.tail = false;
      detail.loose = null; // a grey line's originals are this round's: the next round closes them (render → renderDetail)
    }
    lastIndex = next.index;
    if (turnPending && s.selectedId) { model.select(null); return; }
    if (info.type === 'play') { renderRail(); return; }
    if (info.type === 'select' && !turnPending) { renderDetail(); renderRail(); return; }
    const name = turnPending ? 'turn' : 'local';
    turnPending = false;
    render(name);
  });

  // ---------- first paint: the posture the address asks for, once D's stylesheets are in ----------
  const askedPosture = params.get('posture'), askedHinge = params.has('hinge') ? clamp(Number(params.get('hinge')) || 0, 0, 1) : null;
  if (telling) { posture = 'book'; phase = 'closed'; angle = 0; }
  else if (askedPosture === 'table') { posture = 'table'; phase = 'book'; angle = 180; }
  else if (askedPosture === 'closed' || askedHinge === 0) { phase = 'closed'; angle = 0; }
  else if (askedHinge != null && askedHinge < 1) { angle = angleAt(askedHinge); phase = angle >= HINGE.stable ? 'book' : angle >= HINGE.takeover ? 'reveal' : 'closed'; }
  else if (askedPosture === 'half') { phase = 'book'; angle = 150; }
  Promise.all(sheetsReady).then(() => {
    if (disposed) return;
    host.style.visibility = '';
    render('none');
    showLayers();
    renderGrip();
    requestAnimationFrame(fit);
    if (telling) startTell();
  });

  // ---------- hooks for stills and checks (same names and meaning as foldHome) ----------
  const named = name => {
    if (!name) return null;
    if (getItem(s.state, name)) return name;
    const items = s.state.root.items;
    const hit = items.find(x => scenario.categories?.[x.id]?.short === name) || items.find(x => x.title === name) || items.find(x => x.title.includes(name) || currentAsk(s, x.id)?.prompt?.includes(name));
    return hit?.id || null;
  };
  const centre = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(r.width / 2, 120)), y: Math.round(r.top + Math.min(r.height / 2, 40)) }; };
  window.foldDuo = {
    model, go: i => model.goFrame(i),
    hover: name => { const id = named(name), el = elOf(id); if (el) showPeek(id, el, 'pointer'); },
    unhover: () => hidePeek(),
    open: name => { const id = named(name); if (id) openDetail(id, elOf(id)); },
    close: () => closeDetail(),
    ixAt: seconds => pin(seconds),
    paused: () => !s.playing,
    pointOf: name => centre(elOf(named(name))),
    /** The centre of a part of an item on screen: L / R (book halves), mini, row, card, button, undo. */
    at: (name, part = 'L') => {
      const id = named(name) || name, q = CSS.escape(id);
      const sel = { L: `[data-key="L:${q}"]`, R: `[data-key="R:${q}"]`, mini: `[data-key="mr:${q}"]`, row: `[data-key="i:${q}"]`, button: `[data-id="${q}"] [data-rs-act]`, undo: `[data-id="${q}"] [data-rs-undo]`, tL: `[data-key="tL:${q}"]`, tR: `[data-key="tR:${q}"]`, tbutton: `[data-key="tR:${q}"] [data-rs-act]` }[part];
      const root = part.startsWith('t') ? table : visibleLayer() === 'outer' ? outer : spread;
      const el = root.querySelector(sel);
      el?.scrollIntoView({ block: 'nearest' });
      return centre(el);
    },
    bandPoint: name => { const id = named(name) || name, bandEl = bpin.querySelector('.u-band'); const node = bandEl && [...bandEl.children].find(n => n.dataset.seg === id); if (!node) return null; const r = node.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 2) }; },
    answer: (name, actionId) => {
      const id = named(name), ask = id && currentAsk(s, id);
      if (!ask) return null;
      const n = normalizeAsk(ask);
      const action = n.actions.find(a => a.id === actionId) || n.actions.find(a => a.recommended) || n.actions.find(a => a.meaning === 'decide' || a.meaning === 'act') || n.actions[0];
      give(getItem(s.state, id), action);
      return action.label;
    },
    undo: name => { const id = named(name), item = id && getItem(s.state, id); const r = item && (answeredRecord(item) || recordOf(item)); if (r) { responses.removeKey(r.key); render('undo', { target: id }); } },
    waiting: () => latest?.sh.waiting ?? 0,
    you: () => latest?.sh.you ?? 0,
    shares: () => ({ you: latest?.sh.you, pending: latest?.sh.pend, agent: latest?.sh.agentShare, blank: latest?.sh.blank }),
    top: () => topId(),
    facts: name => {
      const id = named(name) || name, item = getItem(s.state, id), q = CSS.escape(id);
      const L = spread.querySelector(`[data-key="L:${q}"]`), R = spread.querySelector(`[data-key="R:${q}"]`), row = spread.querySelector(`.u-zone [data-key="i:${q}"]`);
      const card = outer.querySelector(`[data-key="i:${q}"]`);
      const place = R ? 'stripe' : spread.querySelector(`[data-key="mr:${q}"]`) ? 'mini' : row ? 'row' : null;
      const el = visibleLayer() === 'outer' ? card : R || spread.querySelector(`[data-key="mr:${q}"]`) || row;
      return { id, present: Boolean(item), ask: (item && currentAsk(s, id)?.id) || null, answered: Boolean(item && answeredRecord(item)), place,
        mark: !el ? null : el.querySelector('.d-receipt') ? 'receipt' : el.matches('.is-done') ? 'done-row' : el.querySelector('.d-row-receipt') ? 'row' : el.querySelector('.d-prior') ? 'prior' : 'none',
        heights: L && R ? { L: Math.round(L.getBoundingClientRect().height), R: Math.round(R.getBoundingClientRect().height) } : null,
        /** its group of inputs on the left page: how many came in this round, whether it is folded (you answered its card),
         * whether a line runs from it into the card, and the group's and the card's tops (they share a row) */
        feed: L ? { n: Number(L.dataset.n || 0), folded: L.classList.contains('is-folded'), link: Boolean(L.querySelector(':scope > .u-link')),
          top: { L: Math.round(L.getBoundingClientRect().top), R: R ? Math.round(R.getBoundingClientRect().top) : null } } : null };
    },
    /** The left page's account of the round: inputs in all, into the cards on the right page (and how many cards), into the
     * Agent's side, folded; the cumulative count; and the items that left the page this round. */
    census: () => { const c = census(compose()); return { n: c.n, mine: c.mine, cards: c.cards, agent: c.agentN, folded: c.loose.length, total: c.total, gone: c.gone.length, counts: c.counts }; },
    /** Scroll a list as a finger would — book (both pages), outer, top / bottom (the tabletop's halves) — to y pt; returns where it is. */
    scroll: (layer, y) => {
      // cols: the tabletop's strip, sideways (both halves together), x pt
      if (layer === 'cols') { if (y != null) tCols.scrollLeft = y; return tCols.scrollLeft; }
      const el = { book: iscroll, outer: oscroll, top: tScroll, bottom: tBot }[layer]; if (!el) return null; if (y != null) setScroll(el, y); return el.scrollTop; },
    posture: (name, opts) => setPosture(name, opts),
    hinge: (value, opts = {}) => { hingeTween?.cancel(); if (opts.animate) tweenTo(value); else setAngle(value); },
    unfold: seconds => tweenTo(180, seconds ?? HAND.open, HAND.ease),
    fold: seconds => tweenTo(0, seconds ?? HAND.close, HAND.ease),
    /** panel: the panel's turn in degrees (0 when it is down: closed at 0° or lying flat as the left page); fold: what the
     * fold draws at this angle (the face's opacity, the blur at the free edge in pt, how many blurred copies show, the veil,
     * the band's growth), the same numbers foldAt() gives. */
    state: () => ({ posture, phase, angle: Math.round(angle), half: book.classList.contains('is-half'), panel: panelUp() ? Math.round(angle) : 0,
      fold: lastFold ? { front: +lastFold.front.alpha.toFixed(3), blur: +lastFold.Bmax.toFixed(2), layers: lastFold.layers.filter(l => l.on).length, veil: +lastFold.veil.alpha.toFixed(3), edge: Math.round(lastFold.veil.edge), band: +lastFold.band.toFixed(3) } : null,
      /** the body: which shell lies still (closed / right while the panel turns / open / table) and the light on the
       * panel's free edge (its sheen and shade, the faces' glint), null while the panel is down */
      body: { shell: bodyEl.dataset.body, light: lastFold ? { sheen: +lastFold.body.sheen.toFixed(3), shade: +lastFold.body.shade.toFixed(3), glint: [+lastFold.body.glint.front.toFixed(3), +lastFold.body.glint.back.toFixed(3)] } : null },
      hero: (visibleLayer() === 'outer' ? outer.querySelector('.d-headline') : visibleLayer() === 'table' ? table.querySelector('.u-hero') : bpin.querySelector('.u-hero'))?.textContent.replace(/\s+/g, ' ').trim(),
      settling: Boolean(morphCtx && !morphCtx.done), tell: tell.running, told: tell.done,
      /** how far each list is scrolled (pt): the book (both pages), the outer screen, the tabletop's two halves */
      scroll: { book: iscroll.scrollTop, outer: oscroll.scrollTop, top: tScroll.scrollTop, bottom: tBot.scrollTop, cols: tCols.scrollLeft },
      /** the lines from the left page's groups into the cards: how many, and how far grown out of the crease (0–1) */
      links: { n: live.links.length, grown: +growthNow().toFixed(3) },
      /** what the left page's detail shows: 'feed' (a group's originals) or 'item' (D's detail); null when it is closed */
      panelMode: !panel.hidden && detail.id ? panel.dataset.mode || 'item' : null }),
    tell: { start: () => startTell(true), skip: () => skipTell(), get running() { return tell.running; } },
    ixState: () => ({
      hover: peekState?.id || null, open: !panel.hidden && detail.id ? detail.id : null, paused: !s.playing,
      peek: Boolean(peekState) && !peekEl.hidden, inPlace: false, linked,
      detail: !panel.hidden && !panel.classList.contains('is-leaving'),
      clip: panel.hidden ? '' : panel.classList.contains('is-growing') || panel.classList.contains('is-leaving') ? 'growing' : 'none',
      focus: panel.contains(document.activeElement) ? 'detail' : document.activeElement?.matches?.(ITEMS) && device.contains(document.activeElement) ? 'proxy' : '',
    }),
  };
  return () => {
    disposed = true;
    stopTell(); hingeTween?.cancel();
    unsubscribe(); unbindResponses();
    refit.disconnect(); for (const link of ownLinks) link.remove(); host.style.visibility = ''; removeEventListener('resize', fit); removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
    document.removeEventListener('keydown', onKey, true);
    for (const c of [beat, morphCtx, detailCtx, peekOut]) settle(c);
    host.classList.remove('variant-d');
    if (window.foldDuo?.model === model) delete window.foldDuo;
  };
}
