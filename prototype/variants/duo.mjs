import { escapeHTML as esc, kindLabel, getItem, colorFor, currentAsk, scenario } from './shared.mjs?v=feedback-loop-1';
import { createResponseStore, composerHTML, keypadHTML, deferHTML, scheduleHTML, bindResponses, normalizeAsk, responseStatus } from '../respond.mjs?v=respond-1';
import { peekHTML } from '../forms/motion/ix.mjs';
import { itemFacts } from '../forms/motion/dial-model.mjs';
import { currentDataset } from '../data/select.mjs';
import { EASE, EASE_IN_OUT, BEATS, play, stepAt, makeBox, measureEl, ghostOf, morph, reveal, band, popKeys, lookOf } from './d-motion.mjs';
import { RS, clock, stamp, dayLong, weekday, createHomeView } from './d-view.mjs';
import { G, HINGE, revealOf, angleOf, REVEAL, edgeAt, revealAlpha, leaveOf, SETTLE, UNSETTLE, SNAP, HAND, BOOK, DETAIL, UNDETAIL, TURN,
  bandSegments, tween, fade } from './duo-motion.mjs';

// E · 折叠屏。合上是 D（同一套 d-view.mjs 标记）；展开时，每件等你的事沿折痕拆成两半：左半 = Agent 为它做了什么，
// 右半 = 要你答什么。右页就是外屏，合上时留在手里的正是右半。铰链是 Agent 与你的分界：64 格份额带的分界压在折痕上，
// 页头的数字从“N 件”翻成“N 份等你回应”。故事与时间表见 forms/polish/duo-motion.md。
//
// 浏览器里没有铰链：折痕上的把手可拖（跟手，松手落到最近的姿态），[ ] 每次 15°，F 一键折 / 展，?hinge=0..1 定格在揭开的
// 那一刻，侧栏三个按钮切“合上 / 书本 / 桌面”。揭开跟着铰链走：每张卡的左半像窗一样从折痕往外开，内容钉在终点；内屏报告
// 跨页（120°）时整理一次（0.40 秒）；往回折过 110° 倒放（0.28 秒）。阈值是常量，待真机量。
// 本页点按的回应只留在内存里，与 D 相同：先“已保存”，下一轮整理后“已收到”；回执跟着条目走，跨姿态、跨折痕、跨版本。

const ITEMS = '.u-half, .u-mini, .d-card, .d-ask-row, .d-line, .d-tail-item';
const PRESSABLE = `${ITEMS}, .u-bandrow, .u-ledger, .d-fold`;
const RS_CONTROLS = '[data-rs-act],[data-rs-amount],[data-rs-open],[data-rs-pick],[data-rs-send],[data-rs-defer],[data-rs-schedule],[data-rs-schedule-custom],[data-rs-pad],[data-rs-pad-set],[data-rs-undo]';
const PRESS = { hint: 0.15, hold: 0.45, slop: 10 };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  const held = new Map(); // item → the stripe's height before you answered it, kept until the next round
  const view = createHomeView({ s, responses, open, drafts, surfaceOf: () => surface });
  const { recordOf, answersFor, answeredRecord, priorRecord, compose, whyHTML, traceOf, answerHTML, answerWords, receiptFor, dot,
    chipHTML, rowHTML, tailToggleHTML, tailItemHTML, buildView, headView, detailParts, detailControls, dueOf, dueWords } = view;
  host.classList.add('variant-d');

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
        <li><b>铰链是分界</b>展开后每件等你的事拆成两半：左半是 Agent 为它做了什么（来源、本轮进了几条、两周份额、为什么升档），右半是要你答什么。两半同一行、同一高。</li>
        <li><b>右页就是外屏</b>合上时留在手里的正是右半；揭开时右页一动不动，左半从折痕往外开。</li>
        <li><b>数字翻成份</b>外屏写“几件等你”；展开后写“64 份里压在你这边的”，左页是 Agent 那边的份数，加上空余正好 64。</li>
        <li><b>份额带</b>页头下 64 格一页宽，分界压在折痕上：墨格是你的，灰格是 Agent 的；答了还没被读到的格子空心，下一轮整理落地才跨过折痕。</li>
        <li><b>手势</b>轻点按钮作答，右半就地收成回执；轻点左半，详情长满左页，右半仍可作答；长按行、单行条或色带格子看概要（色带会把那一件描出来）；Esc 或点空白收回。</li>
        <li><b>键盘</b>← → 换整理时刻 · 空格播放 · Tab 到条与行 · Enter 看详情 · Esc 返回 · [ ] 调铰链 · F 折 / 展。</li>
      </ol></section>
      <p class="d-small">回应只留在本页内存里，不写回状态：先“已保存”，下一轮整理后“已收到”。<button class="d-link" data-u="reset">清除本页回应</button></p>
    </aside>
    <div class="u-area"><div class="u-device" style="width:${G.W}px;height:${G.L}px">
      <div class="u-unlit" aria-hidden="true"></div><div class="u-lit" aria-hidden="true"></div>
      <section class="u-screen u-inner" aria-label="内屏" style="width:${G.W}px;height:${G.PH}px">
        <div class="u-iscroll"><div class="u-spread" style="--pw:${G.PW}px;--gut:${G.gut}px;--gap:${G.gap}px;--rail:${G.rail}px"></div></div>
        ${railHTML({ camera: Math.round(0.70 * G.W) })}
      </section>
      <section class="u-screen u-outer" aria-label="外屏" style="left:${G.OX}px;width:${G.S}px;height:${G.L}px">
        <div class="u-ocol" style="right:${G.rail}px;top:${G.top}px"><div class="d-scroll u-oscroll">
          <header class="d-head"><div class="d-head-main"><div class="d-date"></div></div><h1 class="d-headline" aria-live="polite"></h1><p class="d-since"></p></header>
          <section class="d-cards" aria-label="等你回应"></section><section class="d-rows" aria-label="进行中与结果"></section><section class="d-known" aria-label="次要事项"></section>
        </div><button class="d-fold u-ofold" data-u="fold" aria-label="累计输入与本轮变化"><span class="d-fold-tex" aria-hidden="true"></span><span class="d-fold-text"></span><span class="d-fold-more" aria-hidden="true">›</span><span class="d-band" aria-hidden="true"></span></button></div>
        ${railHTML({ island: true })}
      </section>
      <section class="u-screen u-table" aria-label="桌面姿态" hidden style="width:${G.PH}px;height:${G.W}px;--half:${G.PW}px;--rail:${G.rail}px">
        <div class="u-top"></div><div class="u-bot"></div><div class="u-trail">${railHTML({})}</div>
      </section>
      <div class="u-wins" aria-hidden="true"></div>
      <button class="u-grip" role="slider" aria-label="铰链：拖动折、展；[ ] 微调，F 折 / 展" aria-valuemin="0" aria-valuemax="180"><i aria-hidden="true"></i><span class="u-grip-read" aria-hidden="true"></span></button>
      <div class="d-peek u-peek" role="tooltip" hidden></div>
      <section class="u-ldetail" aria-label="事项详情" hidden><div class="d-detail-bar"></div><div class="d-detail-body"></div><div class="d-detail-actions"></div></section>
      <div class="u-sheethost"><div class="d-sheet-backdrop" hidden></div><section class="d-sheet" role="dialog" aria-label="操作" hidden></section></div>
      <p class="d-sr" aria-live="polite"></p>
    </div></div>
  </div>`;
  const $ = q => host.querySelector(q);
  const area = $('.u-area'), device = $('.u-device'), inner = $('.u-inner'), outer = $('.u-outer'), table = $('.u-table');
  const spread = $('.u-spread'), iscroll = $('.u-iscroll'), oscroll = $('.u-oscroll'), wins = $('.u-wins'), grip = $('.u-grip');
  const lit = $('.u-lit'), unlit = $('.u-unlit'), peekEl = $('.u-peek'), panel = $('.u-ldetail'), sheet = $('.d-sheet'), backdrop = $('.d-sheet-backdrop');
  const sheetHost = $('.u-sheethost'), track = $('.d-track');
  const tTop = $('.u-top'), tBot = $('.u-bot');
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
    return `<div class="u-sysrail" style="width:${G.rail}px" aria-hidden="true">${island ? '<i class="u-island"></i>' : ''}<span class="u-clock"></span><span class="u-wifi">◠</span><span class="u-pill">记<br>录</span></div>${camera ? `<i class="u-cam" style="left:${camera}px" aria-hidden="true"></i>` : ''}`;
  }
  const say = text => { $('.d-sr').textContent = text; };

  // ---------- what each posture shows ----------
  const facts = id => { try { return itemFacts(s.index, id); } catch { return null; } };
  /** D's “why here” tags, torn by whose fact each is: the Agent's (档位, 份额) on the left half, yours (期限, 新问题, 已等) on the right. */
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
  const inputsWords = f => (f?.inputs.length ? `本轮进了 <b>${f.inputs.length} 条</b>${f.stream.length ? ` · ${esc(f.stream.join(' / '))}` : ''}` : '本轮没有新输入');
  function leftHalfHTML(item, mode, prefix = 'L') {
    const f = facts(item.id), ask = currentAsk(s, item.id), lead = mode === 'lead';
    const tags = ask ? splitWhy(item, ask).agent : `<span class="d-tag is-share">${item.share} 份</span>`;
    const chg = f?.change && !['same', 'new'].includes(f.change.kind) ? `<span class="d-tag">${esc(f.change.text)}</span>` : '';
    const first = lead && f?.inputs[0];
    return `<article class="u-half is-left is-${mode} u-cl" data-key="${prefix}:${esc(item.id)}" data-id="${esc(item.id)}" tabindex="0" aria-label="${esc(`Agent 那边：${item.title}`)}">
      <div class="u-lhead"><p class="d-kicker" data-part="title">${dot(colorFor(item, s.state))}<span>${esc(item.title)}</span></p><div class="d-why" data-part="tags">${chg}${tags}</div></div>
      <p class="u-sum" data-part="sum">${esc(item.summary)}</p>
      ${lead && item.reason ? `<p class="u-reason" data-part="reason">${esc(item.reason)}</p>` : ''}
      <div class="u-facts" data-part="facts"><span class="u-in">${inputsWords(f)}</span><span class="u-tr"><span class="u-trendlabel">两周份额</span>${trendHTML(item, lead ? 22 : 16)}</span></div>
      ${first ? `<p class="u-inputs" data-part="inputs"><b>${esc(first.source)}${first.from ? ` · ${esc(first.from)}` : ''}</b> ${esc(first.title)}</p>` : ''}
    </article>`;
  }
  function rightHalfHTML(item, mode, prefix = 'R') {
    const ask = currentAsk(s, item.id), record = answeredRecord(item), id = esc(item.id);
    if (record) return `<article class="u-half is-right is-answered is-${mode} u-cr" data-key="${prefix}:${id}" data-id="${id}" aria-label="${esc(`已回应：${item.title}`)}">${receiptFor(item, record)}</article>`;
    const trace = traceOf(item, ask), prior = priorRecord(item);
    const isNew = ask.frameIndex === s.index && Date.parse(ask.registered_at) === Date.parse(s.frame.at);
    const priorLine = prior ? `<p class="d-prior" data-part="prior">你 ${clock(prior.at)} 答过上一版：${esc(prior.label)}${prior.value ? `「${esc(prior.value)}」` : ''} · ${responseStatus(prior, s.frames, s.cursor).status === 'acknowledged' ? 'Agent 已收到，问题随后改写' : '已保存'}<button type="button" class="d-undo" data-undo-key="${esc(prior.key)}">撤回</button></p>` : '';
    return `<article class="u-half is-right is-${mode} u-cr"${isNew ? ' data-new=""' : ''} data-key="${prefix}:${id}" data-id="${id}" aria-label="${esc(`要你答的：${ask.prompt || item.title}`)}">
      <div class="d-why" data-part="why">${splitWhy(item, ask).you}</div>
      <h3 data-part="prompt">${esc(ask.prompt || item.title)}</h3>
      ${trace ? `<p class="d-trace" data-part="trace">${esc(trace)}</p>` : ''}${priorLine}
      ${answerHTML(item, ask, { inDetail: true })}
    </article>`;
  }
  function miniLeftHTML(item, prefix = 'ml') {
    const f = facts(item.id);
    return `<article class="u-mini is-left u-cl" data-key="${prefix}:${esc(item.id)}" data-id="${esc(item.id)}" tabindex="0" aria-label="${esc(`Agent 那边：${item.title}`)}"><p class="d-kicker" data-part="title">${dot(colorFor(item, s.state))}<span>${esc(item.title)}</span></p><span class="u-share" data-part="share">${item.share} 份</span><span class="u-in" data-part="facts">${f?.inputs.length ? `本轮进了 ${f.inputs.length} 条` : '本轮没有新输入'}</span></article>`;
  }
  function miniRightHTML({ item, answered }, prefix = 'mr') {
    const ask = currentAsk(s, item.id), due = dueOf(item, ask), d = due != null ? dueWords(due) : null, record = answered ? answeredRecord(item) : null;
    const side = record ? `<span class="d-row-done" data-part="side">✓ ${esc(answerWords(record, ask))}</span>` : chipHTML(item, ask);
    return `<article class="u-mini is-right u-cr${record ? ' is-done' : ''}" data-key="${prefix}:${esc(item.id)}" data-id="${esc(item.id)}" tabindex="0" aria-label="${esc(ask.prompt || item.title)}"><div class="u-mini-text"><h3 data-part="prompt">${esc(ask.short || ask.prompt)}</h3>${d ? `<span class="d-tag${d.hot ? ' is-hot' : ''}" data-part="due">${esc(d.text)}</span>` : ''}</div>${side}</article>`;
  }
  /** D's since-line, torn by whose fact each part is: what came in and changed (the Agent's), what is asked of you and what you did. */
  function sinceParts(v) {
    if (s.index === 0 || s.baseIndex >= s.index) return { left: '这是比较起点', right: v.answered ? `你已回应 ${v.answered} 件` : '' };
    const base = s.frames[s.baseIndex], frames = s.frames.slice(s.baseIndex + 1, s.index + 1);
    const received = frames.reduce((n, f) => n + f.events.length, 0);
    const fresh = v.asks.filter(item => Date.parse(currentAsk(s, item.id).registered_at) > Date.parse(base.at)).length;
    const changed = (s.diff.changes || []).filter(c => c.type !== 'annotations_changed').length;
    const mine = new Set(frames.flatMap(f => f.events.filter(e => e.self && e.feedback?.length).flatMap(e => e.feedback.map(l => l.target)))).size;
    return { left: `上次看是 ${stamp(base.at)}，之后收到 ${received} 条，${changed} 处变化`,
      right: [fresh ? `<b>新问题 ${fresh} 个</b>` : '没有新问题', mine ? `你在原处处理了 ${mine} 件` : '', v.answered ? `你在这里已回应 ${v.answered} 件` : ''].filter(Boolean).join(' · ') };
  }
  /** Whose turn each share is on: yours (open asks), answered but not yet read, the Agent's, spare. */
  function shares(v) {
    const open_ = v.asks.filter(item => !answeredRecord(item)), pending = v.asks.filter(item => answeredRecord(item));
    const asks = new Set(v.asks.map(item => item.id));
    const agent = [...s.state.root.items].filter(item => !asks.has(item.id)).sort((a, b) => a.rank - b.rank);
    const blank = Math.max(0, s.state.root.budget - s.state.root.used);
    return { open: open_, pending, agent, blank, you: sum(open_), pend: sum(pending), agentShare: sum(agent), waiting: open_.length };
  }
  function heroHTML(v, sh) {
    if (!v.items.length) return '';
    if (sh.waiting) return `<span class="d-count">${sh.you}</span> 份<small>等你回应</small>`;
    return v.asks.length ? '都回应了<small>等 Agent 整理</small>' : '没有要你回应的事';
  }
  function bookEntries(v, sh, head) {
    const sp = sinceParts(v), at = new Date(s.cursor);
    const sub = `<b>${sh.waiting} 件</b>${sp.right ? ` · ${sp.right}` : ''}${sh.pend ? ` · 另 ${sh.pend} 份你答过了，等 Agent 读到` : ''}`;
    const entries = [
      { key: 'h:L', html: `<header class="u-head u-ledger u-cl" data-key="h:L"><span class="d-fold-tex u-tex" aria-hidden="true"></span><div class="u-ledger-text">
        <p class="u-hero-2" data-part="count"><span class="d-count">${sh.agentShare}</span> 份在 Agent 那边<small>${sh.agent.length} 件${sh.blank ? ` · 空余 ${sh.blank} 份` : ''}</small></p>
        <p class="u-sub" data-part="since">${sp.left}</p><p class="u-sub u-quiet" data-part="ledger">${head.fold}</p></div></header>` },
      { key: 'h:R', html: `<header class="u-head u-cr" data-key="h:R"><div class="d-date" data-part="date">${dayLong.format(at)} ${weekday.format(at)} · ${clock(at)}</div>
        <h1 class="u-hero" data-part="count">${heroHTML(v, sh)}</h1><p class="u-sub" data-part="sub">${v.items.length ? sub : ''}</p></header>` },
      { key: 'band', html: '<div class="u-bandrow" data-key="band" aria-hidden="true"><span class="u-band"></span><span class="u-tick"></span></div>' },
    ];
    v.zone.forEach(({ item }, k) => { const mode = k ? 'mid' : 'lead'; entries.push({ key: `L:${item.id}`, html: leftHalfHTML(item, mode) }, { key: `R:${item.id}`, html: rightHalfHTML(item, mode) }); });
    for (const entry of v.more) entries.push({ key: `ml:${entry.item.id}`, html: miniLeftHTML(entry.item) }, { key: `mr:${entry.item.id}`, html: miniRightHTML(entry) });
    entries.push({ key: 'zone', html: '<section class="u-zone u-cl" data-key="zone" aria-label="Agent 在办"></section>' });
    const others = v.rows.length + v.tail.length;
    entries.push({ key: 'note', html: `<p class="u-note u-cr" data-key="note">${sh.waiting ? `等你的就这 ${sh.waiting} 件。` : '没有等你的事。'}${others ? `左页其余 ${others} 件在 Agent 那边，不用你动。` : ''}</p>` });
    return entries;
  }
  function zoneEntries(v) {
    const out = [];
    if (v.rows.length) out.push({ key: 'h:rows', html: `<div class="d-zone-head" data-key="h:rows"><span data-part="count">Agent 在办 · ${v.rows.length}</span></div>` }, ...v.rows.map(item => ({ key: `i:${item.id}`, html: rowHTML(item) })));
    if (v.tail.length) {
      out.push({ key: 'tail', html: tailToggleHTML(v.tail) });
      if (open.tail) out.push(...v.tail.map(item => ({ key: `i:${item.id}`, html: tailItemHTML(item) })));
    }
    return out;
  }
  function tableEntries(v, sh) {
    const sp = sinceParts(v), at = new Date(s.cursor);
    const cols = v.zone.map((_, k) => (k ? '1fr' : '1.25fr')).join(' ') || '1fr';
    const top = [{ key: 'th', html: `<div class="u-thead" data-key="th"><div><div class="d-date" data-part="date">${dayLong.format(at)} ${weekday.format(at)} · ${clock(at)}</div><h1 class="u-hero" data-part="count">${heroHTML(v, sh)}</h1><p class="u-sub" data-part="sub"><b>${sh.waiting} 件</b>${sp.right ? ` · ${sp.right}` : ''}</p></div>
      <div class="u-thead-r"><p class="u-hero-2">${sh.agentShare} 份在 Agent 那边<small>${sh.agent.length} 件</small></p><p class="u-sub">${sp.left}</p></div></div>` },
      { key: 'tband', html: '<div class="u-tband" data-key="tband" aria-hidden="true"><span class="u-band"></span><span class="u-tick"></span></div>' }];
    v.zone.forEach(({ item }, k) => top.push({ key: `tL:${item.id}`, html: leftHalfHTML(item, k ? 'mid' : 'lead', 'tL') }));
    if (v.rows.length || v.tail.length) top.push({ key: 'tline', html: `<p class="u-rowsline" data-key="tline">Agent 在办：${v.rows.map(r => esc(r.title)).join('、')}${v.tail.length ? `；另有 ${v.tail.length} 项次要事项` : ''}</p>` });
    const bot = v.zone.map(({ item }, k) => ({ key: `tR:${item.id}`, html: rightHalfHTML(item, k ? 'mid' : 'lead', 'tR') }));
    for (const entry of v.more) bot.push({ key: `tm:${entry.item.id}`, html: miniRightHTML(entry, 'tm') });
    return { cols, top, bot };
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
  function choreograph(ctx, before, after, { replaced, removed }, { t, tOf = () => t, fromOf = () => null, enter, exit, used = new Set() }) {
    const k = scale();
    // every list's rect, read once before the first write: a read after each morph would lay the page out again each time
    const rects = new Map();
    for (const { node } of after.values()) if (node.parentElement && !rects.has(node.parentElement)) rects.set(node.parentElement, node.parentElement.getBoundingClientRect());
    for (const [key, { m: now, node: el }] of after) {
      const src = fromOf(key);
      const prev = before.get(src || key);
      if (!prev) { if (enter) enter(el, key); continue; }
      if (src) used.add(src);
      const old = src ? (removed.get(src) || null) : (replaced.get(key) || null);
      const moved = Math.abs(prev.m.left - now.left) > 0.5 || Math.abs(prev.m.top - now.top) > 0.5 || Math.abs(prev.m.height - now.height) > 1;
      if (!old && !moved) continue;
      morph(ctx, { el, was: prev.m, now, old, k, t: tOf(key, el, Boolean(src)), hostRect: rects.get(el.parentElement) });
    }
    const parent = [...after.values()][0]?.node.parentElement;
    for (const [key, { m }] of before) {
      if (after.has(key) || used.has(key)) continue;
      const node = removed.get(key);
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
    if (all || layer === 'outer') { renderOuter(v, sh, head, layer === 'outer' ? ctx : null, name, opts); stale.outer = false; } else stale.outer = true;
    if (all || layer === 'book' || phase === 'reveal') { renderBook(v, sh, head, layer === 'book' ? ctx : null, name, opts); stale.book = false; } else stale.book = true;
    for (const c of host.querySelectorAll('.u-clock')) c.textContent = clock(head.at);
    if (posture === 'table') renderTable(v, sh, layer === 'table' ? ctx : null, name, opts);
    if (phase === 'reveal') buildWindows();
    renderRail();
    markNew(layer === 'outer' ? outer : layer === 'table' ? table : spread, name === 'turn' ? BOOK.land.glow : 0.25);
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
      tOf: key => (key === `i:${self}` && B.self ? { ...B.self, move: B.self.box, parts: B.self.box, flip: B.flip ?? 0, settle: B.settle, z: 2 }
        : { move: B.move, box: B.move, parts: B.move, out: B.swap || B.move, in: B.swap || B.move, fresh: B.fresh, flip: B.flip ?? 0, settle: B.settle }),
      enter: el => reveal(ctx, el, B.enter),
      exit: ghost => play(ctx, ghost, [{ opacity: 1 }, { opacity: 0 }], B.exit),
    });
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

  function renderBook(v, sh, head, ctx, name, opts) {
    const zone = () => spread.querySelector(':scope > .u-zone');
    const before = ctx ? snapshotOf(spread, ...(zone() ? [zone()] : [])) : null;
    const removed = new Map(), replaced = new Map();
    patch(spread, bookEntries(v, sh, head), removed, replaced);
    patch(zone(), zoneEntries(v), removed, replaced);
    // An answered stripe keeps its height until the next round: the left half's context holds it, nothing below moves.
    for (const [id, h] of held) { const r = spread.querySelector(`[data-key="R:${CSS.escape(id)}"]`); if (r) r.style.minHeight = `${h}px`; }
    spread.classList.toggle('is-half', phase === 'book' && angle < HINGE.half);
    const bandEl = spread.querySelector('.u-band'), segs = bandSegments({ open: sh.open, pending: sh.pending, agent: sh.agent, blank: sh.blank });
    const B = name === 'answer' ? BOOK.answer : name === 'undo' ? BOOK.undo : name === 'turn' ? BOOK.land : null;
    paintBand(ctx, bandEl, segs, ctx && B ? B.band : null, ctx && B ? B.band[0] : 0);
    if (!ctx) return;
    const after = snapshotOf(spread, zone());
    const self = opts.target, L = BOOK.local;
    if (name === 'answer' || name === 'undo') {
      // the answered half folds in place; a compact stripe promoted to a full one grows out of itself
      choreograph(ctx, before, after, { replaced, removed }, {
        fromOf: pairing(before),
        tOf: key => (key === `R:${self}` || key === `mr:${self}` ? { ...B.self, z: 2 } : { ...B.self, flip: B.hero }),
        enter: el => reveal(ctx, el, [B.self.in[0], B.self.in[1]]),
        exit: g => play(ctx, g, [{ opacity: 1 }, { opacity: 0 }], B.self.out),
      });
      return;
    }
    if (name === 'turn') { land(ctx, before, after, { replaced, removed }); return; }
    choreograph(ctx, before, after, { replaced, removed }, { t: L, fromOf: pairing(before), enter: el => reveal(ctx, el, L.enter), exit: g => play(ctx, g, [{ opacity: 1 }, { opacity: 0 }], L.exit) });
  }
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

  function renderTable(v, sh, ctx, name, opts) {
    const t = tableEntries(v, sh);
    tTop.style.gridTemplateColumns = t.cols; tBot.style.gridTemplateColumns = t.cols;
    const before = ctx ? snapshotOf(tTop, tBot) : null;
    const removed = new Map(), replaced = new Map();
    patch(tTop, t.top, removed, replaced);
    patch(tBot, t.bot, removed, replaced);
    const bandEl = tTop.querySelector('.u-band');
    if (bandEl) {
      const cell = (G.PH - 28 - G.rail) / 64, x0 = ((sh.agentShare + sh.blank) / 64) * 64 * cell;
      bandEl.style.left = '0px';
      band({ add: () => {}, clean: () => {} }, bandEl, bandSegments({ open: sh.open, pending: sh.pending, agent: sh.agent, blank: sh.blank }).map(x => ({ ...x, from: x.from - 64 + (x0 / cell) })), 64 * cell, null);
      const kinds = new Map(bandSegments({ open: sh.open, pending: sh.pending, agent: sh.agent, blank: sh.blank }).map(x => [x.id, x.kind]));
      for (const node of bandEl.children) node.className = kinds.get(node.dataset.seg) || '';
      tTop.querySelector('.u-tick').style.left = `${x0}px`;
    }
    for (const [id, h] of held) { const r = tBot.querySelector(`[data-key="tR:${CSS.escape(id)}"]`); if (r) r.style.minHeight = `${h}px`; }
    if (!ctx) return;
    const after = snapshotOf(tTop, tBot);
    const B = name === 'answer' ? BOOK.answer : name === 'undo' ? BOOK.undo : null;
    const T = B ? B.self : BOOK.local;
    choreograph(ctx, before, after, { replaced, removed }, { t: { ...T, flip: B?.hero ?? 0 }, enter: el => reveal(ctx, el, BOOK.local.enter), exit: g => play(ctx, g, [{ opacity: 1 }, { opacity: 0 }], BOOK.local.exit) });
  }

  // ---------- the hinge: reveal (follows it), settle (once, timed), fold back (once, timed, then follows it) ----------
  const agentParts = () => outer.querySelectorAll('.d-card [data-part="title"], .d-card [data-part="context"], .d-card .d-tag.is-weight, .d-card .d-tag.is-share, .d-since');
  let winList = [];
  /** Windows over the left page: one per card on the outer screen, its content the book's left half, pinned where it will be. */
  function buildWindows() {
    syncLayers();
    wins.replaceChildren();
    winList = [];
    const zoneCards = [...outer.querySelectorAll('.d-cards > .d-card')];
    // only what the outer screen shows of a card opens a window: its list ends at the 累计 bar
    const v = devRect(oscroll);
    for (const card of zoneCards) {
      const id = card.dataset.id, L = spread.querySelector(`[data-key="L:${CSS.escape(id)}"]`);
      if (!L) continue;
      const full = devRect(card), l = devRect(L);
      const top = Math.max(full.y, v.y), bottom = Math.min(full.y + full.h, v.y + v.h);
      if (bottom - top < 4) continue;
      const c = { x: full.x, y: top, w: full.w, h: bottom - top, cut: top - full.y };
      const win = document.createElement('div');
      win.className = 'u-win';
      const content = L.cloneNode(true);
      content.removeAttribute('data-key'); content.removeAttribute('tabindex');
      content.classList.add('u-win-content');
      Object.assign(content.style, { width: `${l.w}px`, height: `${l.h}px` });
      win.append(content);
      wins.append(win);
      winList.push({ win, content, card: c, L: l, id });
    }
    const headL = spread.querySelector('[data-key="h:L"]');
    if (headL) {
      const h = devRect(headL), win = document.createElement('div');
      win.className = 'u-win is-head';
      const content = headL.cloneNode(true);
      content.removeAttribute('data-key');
      content.classList.add('u-win-content');
      content.querySelector('[data-part="ledger"]')?.style.setProperty('visibility', 'hidden'); // the 累计 line arrives on the settle
      Object.assign(content.style, { width: `${h.w}px`, height: `${h.h}px` });
      win.append(content);
      wins.append(win);
      winList.push({ win, content, card: { x: h.x, y: h.y, w: h.w, h: h.h }, L: h, head: true });
    }
    applyReveal(revealOf(angle));
  }
  function applyReveal(h) {
    const on = angle >= HINGE.takeover && phase !== 'book';
    const edge = edgeAt(h), alpha = revealAlpha(h), leave = leaveOf(h);
    for (const w of winList) {
      const left = Math.max(w.L.x, edge), width = Math.max(0, w.L.x + w.L.w - left);
      Object.assign(w.win.style, { left: `${left}px`, top: `${w.card.y}px`, width: `${width}px`, height: `${w.head ? w.L.h : w.card.h}px`, visibility: on ? 'visible' : 'hidden' });
      w.content.style.left = `${w.L.x - left}px`;
      w.content.style.top = `${-(w.card.cut || 0)}px`;
      w.content.style.opacity = String(alpha);
    }
    for (const p of agentParts()) {
      p.style.filter = on && leave > 0 ? `opacity(${(1 - leave).toFixed(3)})` : '';
      p.style.translate = on && leave > 0 ? `${(-REVEAL.drift * leave).toFixed(1)}px 0` : '';
    }
    // The lit part of the inner screen: from the window's edge (minus a margin) to the right; before the takeover, a sliver.
    const boundary = angle < HINGE.takeover ? G.crease - (angle / HINGE.takeover) * (G.crease - (edgeAt(0) - G.gut)) : Math.max(0, edge - G.gut);
    Object.assign(lit.style, { left: `${boundary}px`, width: `${G.W - boundary}px`, opacity: angle >= HINGE.takeover ? '1' : '0' });
    Object.assign(unlit.style, { left: `${boundary}px`, width: `${Math.max(0, G.OX - boundary)}px`, opacity: angle > 0 && angle < HINGE.takeover ? '1' : '0' });
  }
  const stale = { outer: false, book: false };
  function syncLayers() {
    if (!latest) return;
    if (stale.outer) { stale.outer = false; renderOuter(latest.v, latest.sh, latest.head, null, 'none', {}); }
    if (stale.book) { stale.book = false; renderBook(latest.v, latest.sh, latest.head, null, 'none', {}); }
  }
  function showLayers() {
    syncLayers();
    const book = posture !== 'table' && phase === 'book', outerOn = posture !== 'table' && phase !== 'book';
    inner.classList.toggle('is-on', book);
    outer.classList.toggle('is-off', !outerOn);
    wins.hidden = !(posture !== 'table' && phase === 'reveal');
    table.hidden = posture !== 'table';
    grip.hidden = posture === 'table';
    device.classList.toggle('is-table', posture === 'table');
    if (posture === 'table') { Object.assign(lit.style, { opacity: '0' }); Object.assign(unlit.style, { opacity: '0' }); }
    else if (book) { Object.assign(lit.style, { left: '0px', width: `${G.W}px`, opacity: '1' }); unlit.style.opacity = '0'; }
    spread.classList.toggle('is-half', book && angle < HINGE.half);
    fit();
  }
  function setAngle(a) {
    if (posture === 'table') return;
    angle = clamp(a, 0, 180);
    // folding back past 110°: the settle runs backwards, then the reveal follows the hinge (in one call when it jumps)
    if (phase === 'book' && angle < HINGE.back) unsettle();
    if (phase === 'book') spread.classList.toggle('is-half', angle < HINGE.half);
    else if (angle >= HINGE.stable) settleSpread();
    else {
      const next = angle >= HINGE.takeover ? 'reveal' : 'closed';
      if (next !== phase) {
        // opening from closed: the windows are cut from the spread as it is now; closing fully: they go
        if (next === 'reveal' && phase === 'closed') buildWindows();
        if (next === 'closed') { winList = []; wins.replaceChildren(); }
        phase = next; showLayers();
      }
      applyReveal(revealOf(angle));
    }
    renderGrip();
  }
  /** The spread is reported: right halves compact, the folded asks fan out, 件 turns to 份, the band is drawn (0.40 s). */
  function settleSpread() {
    settle(morphCtx);
    const animate = !reduced() && phase === 'reveal';
    const k = scale(), cards = new Map();
    for (const card of outer.querySelectorAll('.d-cards > [data-key]')) cards.set(card.dataset.key, { m: measure(card, k), node: card });
    const headline = outer.querySelector('.d-headline'), date = outer.querySelector('.d-date'), fold = outer.querySelector('.d-fold');
    const hm = animate ? { r: headline.getBoundingClientRect(), node: headline.cloneNode(true) } : null;
    const dm = animate ? date.getBoundingClientRect() : null, fm = animate ? { r: fold.getBoundingClientRect(), node: fold.cloneNode(true) } : null;
    const windows = new Map(winList.filter(w => !w.head).map(w => [w.id, w]));
    phase = 'book';
    winList = []; wins.replaceChildren();
    for (const p of agentParts()) { p.style.filter = ''; p.style.translate = ''; }
    iscroll.scrollTop = 0;
    showLayers();
    stale.book = false; renderBook(latest.v, latest.sh, latest.head, null, 'none', {});
    renderRail();
    if (!animate) return;
    const ctx = newCtx();
    morphCtx = ctx;
    // the buttons, the tags left to you and the trace slide to their place (the Agent's words have already gone with the reveal)
    const S = SETTLE, compact = { move: S.compact, box: S.compact, parts: S.compact, out: [0, 0.12], in: [0.06, 0.2], fresh: [0.10, 0.18], flip: S.hero, settle: S.compact[1], keep: new Set(['answer', 'why', 'trace']) };
    for (const [key, { m: was, node }] of cards) {
      const id = key.slice(2), R = spread.querySelector(`[data-key="R:${CSS.escape(id)}"]`), L = spread.querySelector(`[data-key="L:${CSS.escape(id)}"]`);
      if (!R) continue;
      const old = node.cloneNode(true);
      for (const p of old.querySelectorAll('[data-part="title"], [data-part="context"], .d-tag.is-weight, .d-tag.is-share')) p.style.filter = 'opacity(0)';
      morph(ctx, { el: R, was, now: measure(R, k), old, k, t: { ...compact, z: 2 }, hostRect: spread.getBoundingClientRect() });
      if (L) {
        const now = measure(L, k), w = windows.get(id);
        const fromTop = w ? device.getBoundingClientRect().top + w.card.y * k : was.top, fromH = w ? w.card.h * k : was.height;
        morph(ctx, { el: L, was: { ...now, top: fromTop, height: fromH, parts: now.parts }, now, old: null, k, t: compact, hostRect: spread.getBoundingClientRect() });
      }
    }
    const more = cards.get('more')?.m;
    for (const el of spread.querySelectorAll(':scope > .u-mini')) {
      if (el.classList.contains('is-right') && more) morph(ctx, { el, was: { ...more, parts: new Map() }, now: measure(el, k), old: null, k, t: { move: S.minis, box: S.minis, parts: S.minis, fresh: S.minis, out: S.minis, in: S.minis, flip: 0, settle: S.minis[1] }, hostRect: spread.getBoundingClientRect() });
      else play(ctx, el, [{ opacity: 0, transform: 'translateX(40px)' }, { opacity: 1, transform: 'none' }], S.minis);
    }
    fade(ctx, spread.querySelector('.u-zone'), true, S.rows, 14);
    fade(ctx, spread.querySelector('.u-note'), true, S.rows, 14);
    fade(ctx, spread.querySelector('[data-part="ledger"]'), true, S.ledger);
    const bandRow = spread.querySelector('.u-bandrow');
    if (bandRow) play(ctx, bandRow, [{ opacity: 0 }, { opacity: 1 }], S.band);
    const headR = spread.querySelector('[data-key="h:R"]');
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
      const ghost = ghostOf(fm.node, fm.r, k, device, 6);
      play(ctx, ghost, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(24px)', opacity: 0 }], S.ledger);
      ctx.clean(() => ghost.remove());
    }
    arm(ctx, () => { if (morphCtx === ctx) morphCtx = null; });
  }
  /** Folding back past 110°: the settle backwards, faster (0.28 s); then the windows close with the hinge. */
  function unsettle() {
    settle(morphCtx);
    const animate = !reduced();
    const k = scale(), halves = new Map();
    for (const el of spread.querySelectorAll(':scope > [data-key]')) halves.set(el.dataset.key, { m: measure(el, k), node: el });
    phase = 'reveal';
    outer.classList.remove('is-off');
    // the outer screen as you left it, the Agent's parts still away (they come back as the hinge closes)
    showLayers();
    buildWindows();
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
    for (const w of winList) {
      if (w.head) continue;
      const R = halves.get(`L:${w.id}`);
      if (!R) continue;
      const fromY = (R.m.top - device.getBoundingClientRect().top) / k, fromH = R.m.height / k;
      play(ctx, w.win, [{ top: `${fromY}px`, height: `${fromH}px` }, { top: `${w.card.y}px`, height: `${w.card.h}px` }], U.expand);
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
    if (s.selectedId) model.select(null);
    if (name === 'table') {
      if (posture === 'table') return;
      hingeTween?.cancel();
      const from = visibleLayer() === 'book' ? inner : outer;
      posture = 'table'; phase = 'book'; angle = 180;
      renderTable(latest.v, latest.sh, null, 'none', {});
      showLayers();
      if (animate) turnIn(from);
      renderRail(); renderGrip();
      return;
    }
    if (posture === 'table') {
      posture = 'book';
      const fromTable = table;
      phase = name === 'closed' ? 'closed' : 'book';
      angle = name === 'closed' ? 0 : 180;
      winList = []; wins.replaceChildren();
      if (phase === 'closed') applyReveal(0);
      stale.book = false; renderBook(latest.v, latest.sh, latest.head, null, 'none', {});
      showLayers();
      if (animate) turnIn(fromTable, true);
      renderRail(); renderGrip();
      return;
    }
    tweenTo(name === 'closed' ? 0 : 180, animate ? null : 0);
  }
  /** The system turns the screen: the old layout fades, the new one comes in, its columns one by one (0.36 s). */
  function turnIn(from, back = false) {
    const ctx = newCtx();
    const ghost = from.cloneNode(true);
    ghost.hidden = false; ghost.classList.remove('is-off', 'is-on');
    ghost.classList.add('u-turn-ghost');
    device.append(ghost);
    ctx.clean(() => ghost.remove());
    play(ctx, ghost, [{ opacity: 1 }, { opacity: 0 }], TURN.out);
    const items = back ? [...spread.querySelectorAll(':scope > .u-half, :scope > .u-mini')] : [...tTop.children, ...tBot.children];
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
  const postureWords = () => (posture === 'table' ? '桌面：上半立着看，下半平放按' : phase === 'book' ? (angle < HINGE.half ? '半折书本：两半离开折痕' : '全开书本') : phase === 'reveal' ? '展开中：左半从折痕往外开' : '合上：外屏');

  // ---------- fit: the device at its point size, scaled into what is left beside the rail ----------
  function fit() {
    const w = posture === 'table' ? G.PH : G.W, h = posture === 'table' ? G.W : G.L;
    device.style.width = `${w}px`; device.style.height = `${h}px`;
    const room = area.getBoundingClientRect();
    // the shell's switcher sits at the bottom of the window (hidden when embedded in all.html or the site's viewer)
    const bar = document.querySelector('.lab-switcher'), reserve = bar && getComputedStyle(bar).display !== 'none' ? 104 : 24;
    const k = Math.max(0.3, Math.min(1.1, room.width / w, (innerHeight - room.top - window.scrollY - reserve) / h));
    device.style.setProperty('--k', k.toFixed(4));
    device.style.setProperty('--dx', `${Math.max(0, (room.width - w * k) / 2).toFixed(1)}px`);
    area.style.height = `${Math.ceil(h * k) + 8}px`;
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
  const bandOf = () => (posture === 'table' ? tTop : spread).querySelector('.u-band');
  /** Which item's run of the band lies under client x (null over the spare cells). */
  function bandHit(x) {
    const bandEl = bandOf();
    if (!bandEl) return null;
    const b = bandEl.getBoundingClientRect(), k = scale();
    const cellsAt = (x - b.left) / k / (posture === 'table' ? (G.PH - 28 - G.rail) / 64 : G.cell);
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
  const detail = { id: null, origin: null };
  function panelRect() {
    if (posture === 'table') return { x: 0, y: 0, w: G.PH - G.rail, h: G.PW };
    if (phase === 'book') return { x: 0, y: 0, w: G.PW - G.gap / 2 + 4, h: G.PH };
    return { x: G.OX, y: 0, w: G.S - G.rail, h: G.L };
  }
  const elOf = id => {
    const root = visibleLayer() === 'book' ? spread : visibleLayer() === 'table' ? table : outer;
    return root.querySelector(`[data-key="L:${CSS.escape(id)}"], [data-key="tL:${CSS.escape(id)}"], [data-key="ml:${CSS.escape(id)}"], [data-key="i:${CSS.escape(id)}"], [data-key="mr:${CSS.escape(id)}"], [data-key="tm:${CSS.escape(id)}"]`);
  };
  function openDetail(id, origin) { if (!id) return; detail.origin = origin || elOf(id); if (s.selectedId === id) renderDetail(); else model.select(id); }
  function renderDetail() {
    const id = s.selectedId, item = id && getItem(s.state, id);
    if (!item) { if (detail.id) closePanel(); return; }
    const parts = detailParts(item);
    // On the spread the right half keeps the controls; the panel carries them only for what has no right half.
    const hasHalf = Boolean(spread.querySelector(`[data-key="R:${CSS.escape(id)}"], [data-key="mr:${CSS.escape(id)}"]`)) && visibleLayer() !== 'outer';
    const actions = hasHalf ? '' : parts.actions;
    const fill = () => {
      panel.querySelector('.d-detail-bar').innerHTML = parts.bar;
      panel.querySelector('.d-detail-body').innerHTML = parts.body;
      const act = panel.querySelector('.d-detail-actions');
      act.innerHTML = actions; act.hidden = !actions;
    };
    if (detail.id === id) { const top = panel.querySelector('.d-detail-body').scrollTop; fill(); panel.querySelector('.d-detail-body').scrollTop = top; return; }
    const switching = Boolean(detail.id) && !panel.hidden;
    // where the detail grows from, read before the panel is filled (a read after it would lay the page out again)
    const from = detail.origin?.isConnected ? detail.origin : elOf(id), originRect = !switching && from ? devRect(from) : null;
    detail.id = id;
    fill();
    markOpen(id);
    if (switching) { if (!reduced()) panel.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 180, easing: EASE }); return; }
    openPanel(originRect);
  }
  function markOpen(id) {
    for (const el of host.querySelectorAll('.is-open')) el.classList.remove('is-open');
    if (id) for (const el of host.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)) if (el.matches(ITEMS)) el.classList.add('is-open');
    device.classList.toggle('is-detail', Boolean(id));
  }
  function openPanel(originRect = null) {
    settle(detailCtx);
    hidePeek(true);
    const r = panelRect();
    Object.assign(panel.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    panel.hidden = false;
    panel.classList.remove('is-leaving');
    const origin = detail.origin?.isConnected ? detail.origin : elOf(detail.id);
    const back = () => panel.querySelector('[data-d="back"]')?.focus({ preventScroll: true });
    if (reduced() || !origin) { panel.classList.remove('is-growing'); back(); return; }
    const ctx = newCtx();
    detailCtx = ctx;
    panel.classList.add('is-growing');
    const o = originRect || devRect(origin);
    const box = makeBox(device, { bg: 'var(--paper)', r: 20 }, Math.max(o.w, r.w));
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
    detail.id = null; detail.origin = null;
    markOpen(null);
    settle(detailCtx);
    if (panel.hidden) return;
    const done = () => { panel.hidden = true; panel.classList.remove('is-leaving', 'is-growing'); };
    const focusBack = () => { if (origin?.isConnected && panel.contains(document.activeElement)) origin.focus({ preventScroll: true }); else if (origin?.isConnected && !host.contains(document.activeElement)) origin.focus({ preventScroll: true }); };
    focusBack();
    if (reduced() || !origin) { done(); return; }
    const ctx = newCtx();
    detailCtx = ctx;
    panel.classList.add('is-leaving');
    const r = panelRect(), o = devRect(origin);
    const box = makeBox(device, { bg: 'var(--paper)', r: 20 }, Math.max(o.w, r.w));
    box.el.classList.add('u-detail-box');
    box.animate(ctx, r, o, UNDETAIL.frame);
    play(ctx, box.el, [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], UNDETAIL.frame, { easing: 'linear' });
    ctx.clean(() => box.remove());
    play(ctx, panel, [{ opacity: 1 }, { opacity: 0 }], UNDETAIL.content, { easing: 'linear' });
    arm(ctx, () => { if (detailCtx === ctx) detailCtx = null; done(); });
  }
  const closeDetail = () => { if (s.selectedId) model.select(null); else if (detail.id) closePanel(); };

  // ---------- sheets (D's): the snooze options, the compact chip's controls, a reply, an amount, a time ----------
  let sheetReturn = null;
  function openSheet(html, label = '操作') {
    hidePeek(true);
    const r = posture === 'table' ? { x: 0, y: G.PW, w: G.PH, h: G.PW } : phase === 'book' ? { x: G.PW, y: 0, w: G.PW, h: G.PH } : { x: G.OX, y: 0, w: G.S, h: G.L };
    Object.assign(sheetHost.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
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
    // the stripe's height, held while it is a receipt (its left half keeps the context)
    const r = spread.querySelector(`[data-key="R:${CSS.escape(item.id)}"]`);
    if (r && visibleLayer() === 'book' && action.meaning !== 'snooze' && action.meaning !== 'ack') held.set(item.id, r.getBoundingClientRect().height / scale());
    const tr = tBot.querySelector(`[data-key="tR:${CSS.escape(item.id)}"]`);
    if (tr && posture === 'table' && action.meaning !== 'snooze' && action.meaning !== 'ack') held.set(item.id, tr.getBoundingClientRect().height / scale());
    const record = responses.save(item, action, { ask: currentAsk(s, item.id), value, until, at: s.cursor });
    say(record.meaning === 'ack' || record.meaning === 'snooze' ? answerWords(record) : `已保存 · ${answerWords(record, currentAsk(s, item.id))}`);
    render(record.meaning === 'snooze' || record.meaning === 'ack' ? 'local' : 'answer', { target: item.id });
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
      held.delete(target);
      say('已撤回');
      render('undo', { target });
      const root = visibleLayer() === 'book' ? spread : visibleLayer() === 'table' ? table : outer;
      root.querySelector(`[data-id="${CSS.escape(target)}"] [data-rs-act]`)?.focus({ preventScroll: true });
    },
  });

  // ---------- pointer: tap, long press, the hinge handle ----------
  let press = null, pressHeld = false, swallowUntil = 0, drag = null;
  const cancelPress = () => { if (!press) return; clearTimeout(press.hint); clearTimeout(press.fire); press.el.classList.remove('is-pressing'); press = null; };
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
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS.slop) cancelPress();
  }
  function onUp(event) {
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
    if (t.closest(RS_CONTROLS)) return;
    const u = t.closest('[data-u]')?.dataset.u;
    if (u) { railAction(u); return; }
    const p = t.closest('[data-posture]')?.dataset.posture;
    if (p) { endTellOnInput(); setPosture(p); return; }
    if (t === backdrop) { closeSheet(); return; }
    if (!device.contains(t)) return;
    if (peekState) {
      if (t.closest('.u-peek')) { const id = peekState.id, origin = peekState.el; hidePeek(true); openDetail(id, origin.matches('.u-bandrow') ? elOf(id) : origin); return; }
      hidePeek(); event.preventDefault(); return;
    }
    const d = t.closest('[data-d]')?.dataset.d;
    if (d === 'back') { closeDetail(); return; }
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
    const item = t.closest(ITEMS);
    // An answered right half is your receipt: only 撤回 on it acts (a second tap where the button was does nothing).
    if (item?.matches('.u-half.is-answered')) return;
    if (item?.dataset.id && !t.closest('.d-sheet')) {
      if (s.selectedId === item.dataset.id && item.matches('.u-half.is-left, .u-mini.is-left')) { closeDetail(); return; }
      // A tap on the right half's own words opens the detail too; its buttons answer (bindResponses).
      openDetail(item.dataset.id, item.matches('.u-half.is-right') ? (spread.querySelector(`[data-key="L:${CSS.escape(item.dataset.id)}"]`) || item) : item);
      return;
    }
    if (s.selectedId && !t.closest('.u-ldetail')) closeDetail();
  }
  function railAction(u) {
    endTellOnInput();
    if (u === 'prev') model.goFrame(s.index - 1);
    else if (u === 'next') model.goFrame(s.index + 1);
    else if (u === 'play') model.togglePlay();
    else if (u === 'reset') { for (const r of responses.list(Infinity)) responses.removeKey(r.key); held.clear(); render('local'); }
    else if (u === 'replay') startTell(true);
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
  iscroll.addEventListener('scroll', () => { cancelPress(); if (peekState?.via === 'press') hidePeek(true); }, { passive: true });
  oscroll.addEventListener('scroll', () => cancelPress(), { passive: true });
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
      openDetail(event.target.dataset.id, event.target);
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
    if (replay) { for (const r of responses.list(Infinity)) responses.removeKey(r.key); held.clear(); }
    tell.running = true; tell.done = false;
    const plan = TELL[dataset];
    hingeTween?.cancel();
    if (posture === 'table') { posture = 'book'; }
    phase = 'closed'; angle = 0; winList = []; wins.replaceChildren();
    model.goFrame(frameIndex(plan.start));
    render('none'); showLayers(); applyReveal(0);
    let t = 0;
    const at = (dt, fn) => { t += dt; tell.timers.push(setTimeout(() => { if (tell.running) fn(); }, t * 1000)); };
    at(0.9, () => tweenTo(180, HAND.open, x => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)));
    at(HAND.open + 0.4 + 1.6, () => answerItem(planItem(), false, plan.action));
    at(2.0, () => model.goFrame(frameIndex(plan.next)));
    at(2.8, () => tweenTo(0, HAND.close, x => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)));
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
    phase = 'closed'; angle = 0; winList = []; wins.replaceChildren();
    for (const p of agentParts()) { p.style.filter = ''; p.style.translate = ''; }
    showLayers(); applyReveal(0);
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
      open.more = false; open.tail = false; held.clear();
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
  else if (askedHinge != null && askedHinge < 1) { phase = 'reveal'; angle = angleOf(askedHinge); }
  else if (askedPosture === 'half') { phase = 'book'; angle = 150; }
  Promise.all(sheetsReady).then(() => {
    if (disposed) return;
    host.style.visibility = '';
    render('none');
    showLayers();
    if (phase !== 'book') { if (phase === 'reveal') buildWindows(); applyReveal(revealOf(angle)); }
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
    bandPoint: name => { const id = named(name) || name, bandEl = spread.querySelector('.u-band'); const node = bandEl && [...bandEl.children].find(n => n.dataset.seg === id); if (!node) return null; const r = node.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 2) }; },
    answer: (name, actionId) => {
      const id = named(name), ask = id && currentAsk(s, id);
      if (!ask) return null;
      const n = normalizeAsk(ask);
      const action = n.actions.find(a => a.id === actionId) || n.actions.find(a => a.recommended) || n.actions.find(a => a.meaning === 'decide' || a.meaning === 'act') || n.actions[0];
      give(getItem(s.state, id), action);
      return action.label;
    },
    undo: name => { const id = named(name), item = id && getItem(s.state, id); const r = item && (answeredRecord(item) || recordOf(item)); if (r) { responses.removeKey(r.key); held.delete(id); render('undo', { target: id }); } },
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
        heights: L && R ? { L: Math.round(L.getBoundingClientRect().height), R: Math.round(R.getBoundingClientRect().height) } : null };
    },
    posture: (name, opts) => setPosture(name, opts),
    hinge: (value, opts = {}) => { hingeTween?.cancel(); if (opts.animate) tweenTo(value); else setAngle(value); },
    unfold: seconds => tweenTo(180, seconds ?? HAND.open),
    fold: seconds => tweenTo(0, seconds ?? HAND.close),
    state: () => ({ posture, phase, angle: Math.round(angle), half: spread.classList.contains('is-half'), windows: winList.length,
      hero: (visibleLayer() === 'outer' ? outer.querySelector('.d-headline') : visibleLayer() === 'table' ? table.querySelector('.u-hero') : spread.querySelector('.u-hero'))?.textContent.replace(/\s+/g, ' ').trim(),
      settling: Boolean(morphCtx && !morphCtx.done), tell: tell.running, told: tell.done }),
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
