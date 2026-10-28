import { createResponseStore, responseStatus, normalizeAsk, setTimeZone, bindResponses, nextMorning, clock, day } from '../respond.mjs';
import { itemFacts, shortOf } from './motion/dial-model.mjs';
import { IX, peekHTML, detailHTML as ixDetailHTML } from './motion/ix.mjs';
import { responseSentence } from './sketches/stage.mjs';
import { EASE, EASE_IN, EASE_IN_OUT, BEATS as D_BEATS, STAGGER, STAGGER_MAX, GROW, SHRINK, PRESS, popKeys, play, stepAt, makeBox,
  measureEl, ghostOf, morph, reveal, roll } from '../variants/d-motion.mjs';

// 回应托盘（第四轮 08，手机 390 × 844）：每个开着的问题一个托盘，托盘有几排就要你点几下。
// 一下就完的（confirm、approve、choose、带建议句或预填金额的回复、拍照）只有一排按钮；推后、定时刻、没有建议句的
// 回复要先点开再挑（或写），多一排。按掉一下矮一排，答完原地收成一行回执，英雄数字“N 下答完 M 个问题”减去那几下；
// 下一轮整理读到了，回执才让出位置，落到托盘下面的“已收到与关上”。几下的口径见 polish/trays-motion.md 2.1。
// 本页作答只在内存里：先“已保存”，推进到下一轮整理后“已收到”，可以撤回；不写回状态。
//
// 动画沿用 D 手机首页的部件（../variants/d-motion.mjs）：同一件事的托盘、回执、“已收到”的行与详情是同一个盒子变形，
// 只动 transform 与 opacity，切点读一次布局。三拍：叠起（换轮）、按下（每一下矮一排）、让位（下一轮读到）。
// 手势照 D：轻点按钮作答、轻点托盘从它长出详情、长按 0.45 秒代替悬停出概要卡、“已收到”的行左滑知道了、详情到顶时下拉收回。
// 概要卡与详情里的“份额 · 逐轮”“本轮进了它”来自共用交互模块 motion/ix.mjs，时序取它的 IX。
// 直接打开（顶层、无 ?frame=、无 referrer）时讲一遍三拍；任意键或轻点跳过；带帧、画廊、合页与链来的都静止。
const HOUR = 3600000, DAY = 86400000;
const WEIGHT_RANK = { critical: 0, high: 1, normal: 2, low: 3, trace: 4 };
const WEIGHT_NAME = { critical: '关键', high: '高', normal: '常规', low: '低', trace: '微量' };
const MEANING = { decide: '需要你决定', input: '需要你提供', act: '需要你去做' };
const PLAY_MS = 5600;
// Beats, seconds from the cut: D's turn, answer and undo; the first tap of a two-step tray (step) and its way back (unstep).
const BEATS = {
  turn: D_BEATS.turn,
  answer: D_BEATS.answer,
  undo: D_BEATS.undo,
  step: { self: { out: [0, 0.12], box: [0, 0.24], in: [0.08, 0.20] }, hero: 0.12, move: [0.12, 0.28], swap: [0.12, 0.28], fresh: [0.16, 0.16],
    flip: 0.12, enter: [0.12, 0.28], exit: [0.12, 0.20], settle: 0.40, glow: 0.40 },
  unstep: { self: { out: [0, 0.10], box: [0, 0.22], in: [0.08, 0.18] }, hero: 0.08, move: [0, 0.24], swap: [0, 0.24], fresh: [0.10, 0.16],
    flip: 0.08, enter: [0, 0.24], exit: [0, 0.18], settle: 0.30, glow: 0.30 },
  local: D_BEATS.local,
};
const ALL = { has: () => true }; // morph's `keep`: every part shows its new words at once
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerpRect = (a, b, q) => ({ x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, w: a.w + (b.w - a.w) * q, h: a.h + (b.h - a.h) * q });
const money = value => Number(value || 0).toLocaleString('zh-CN');
const chars = text => [...String(text || '')];
function span(ms) {
  const abs = Math.abs(ms);
  return abs < HOUR ? `${Math.max(1, Math.round(abs / 60000))} 分钟` : abs < 2 * DAY ? `${Math.round(abs / HOUR)} 小时` : `${Math.round(abs / DAY)} 天`;
}
/** ≤16 characters, so a tray's title is one line: the dataset's `short`, else the clause after the last colon, else a cut. */
function shortAsk(ask, item) {
  if (ask.short) return ask.short;
  const prompt = String(ask.prompt || item?.title || '').trim();
  if (chars(prompt).length <= 16) return prompt;
  const tail = prompt.split(/[：:]/).at(-1).trim();
  if (tail && chars(tail).length <= 16 && chars(tail).length >= 4) return tail;
  return `${chars(prompt).slice(0, 15).join('')}…`;
}

/**
 * How many taps a question takes on its tray (the shortest path), and what its rows are. polish/trays-motion.md 2.1.
 *   press  one row of buttons; one of them answers (confirm, approve, choose; a text option is a quiet extra)
 *   pick   tap the first button (推到…, 选时间), then a day or a moment: two rows
 *   write  tap 回一句, then write and send: two rows (and the writing)
 *   chips  one row of suggested sentences or amounts; one of them answers
 *   photo  one button: 拍一张 (and the photo)
 */
export function effortOf(rawAsk) {
  const n = normalizeAsk(rawAsk);
  const direct = n.actions.filter(a => a.meaning === 'decide' || a.meaning === 'act');
  const field = n.actions.find(a => a.meaning === 'input');
  const type = field?.input?.type || 'text';
  if (n.expects === 'defer') return { kind: 'pick', mode: 'defer', taps: 2, action: n.actions[0], step: n.actions[0]?.label || '推到…', then: '挑一天' };
  if (direct.length) return { kind: 'press', taps: 1, direct, extra: n.actions.filter(a => a.meaning === 'input') };
  if (type === 'datetime') return { kind: 'pick', mode: 'time', taps: 2, action: field, step: field.label || '选时间', then: '挑一个时刻' };
  if (type === 'photo') return { kind: 'photo', taps: 1, action: field, also: '拍照' };
  if (type === 'money') {
    const values = [...new Set([field.input.prefill, ...(field.input.suggestions || [])].filter(v => Number.isFinite(v) && v > 0))];
    return values.length ? { kind: 'chips', taps: 1, action: field, chips: values.map(v => `¥${money(v)}`) }
      : { kind: 'write', taps: 2, action: field, step: field.label || '填一个数', then: '填好交出', also: '填一个数' };
  }
  const suggestions = field?.input?.suggestions || [];
  return suggestions.length ? { kind: 'chips', taps: 1, action: field, chips: suggestions, custom: true }
    : { kind: 'write', taps: 2, action: field, step: '回一句', then: '写好发出', also: '写一句' };
}
/** The path in words, for the summary card and the detail. */
function pathWords(e) {
  if (e.kind === 'pick') return `先点「${e.step}」，再${e.then}`;
  if (e.kind === 'write') return `先点「${e.step}」，${e.then}（另要${e.also}）`;
  if (e.kind === 'chips') return '点一个就交出';
  if (e.kind === 'photo') return '点「拍一张」（另要拍照）';
  return e.direct.length > 1 ? '点一个选项就答完' : `点「${e.direct[0].label}」就答完`;
}
export const RULE = '几下 = 托盘上最短的那条路要点几下：确认、批准、选择各 1 下；推后、定时刻要先点开再挑，2 下；没有建议句的回复先点开、写好再发出，2 下另加写一句；建议句、预填金额与拍照 1 下。托盘几排就是几下。';

export function mount(stage, model, kit) {
  const { esc, formatTime, formatDate, scenario } = kit;
  setTimeZone(scenario.timeZone || 'Asia/Shanghai');
  const zone = scenario.timeZone || 'Asia/Shanghai';
  const dayLong = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, month: 'long', day: 'numeric' });
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, weekday: 'short' });
  const weekdayEn = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' });
  const md = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, month: 'numeric', day: 'numeric' });
  const shortDate = at => md.format(new Date(at)).replace(/月/, '/').replace(/日/, '');
  const stamp = at => `${formatDate(at)} ${formatTime(at)}`;
  const last = scenario.frames.length - 1;
  let s = model.snapshot(), lastIndex = s.index, disposed = false, restoring = false, quiet = false;
  document.body.classList.add('tr-page');
  const responses = createResponseStore(); // in memory only (home-motion.md 4.1, 9)
  const drafts = new Map();
  const steps = new Set();    // ask ids whose first tap has been made (two-step trays)
  const custom = new Set();   // ask ids whose 挑日子 field is open
  const known = new Set();    // ledger rows swiped away (知道了)
  const pulsed = new Set();   // frame:item pairs whose new-question ring has played
  const embedded = window.parent !== window;
  let tour = null, told = []; // 讲一遍: its timers, and the records it pressed for you

  stage.innerHTML = `<div class="tr-wrap"><div class="tr-screen">
      <div class="tr-scroll">
        <header class="tr-head"><p class="tr-kick"></p>
          <div class="tr-hero" tabindex="0" data-id="hero" role="group" aria-live="polite"><b class="tr-n"><span class="d-count">0</span></b><span class="tr-unit"><span class="tr-u1"></span><span class="tr-of"></span></span></div>
          <p class="tr-split"></p></header>
        <section class="tr-stack" aria-label="等你回应的问题"></section>
        <section class="tr-ledger" aria-label="已收到与关上"></section>
        <footer class="tr-foot"><p class="tr-rule">${esc(RULE)}</p>
          <p class="tr-keys"><span class="tr-keys-t"></span><span class="tr-keys-b"><button type="button" data-t="play">▶ 连播</button><button type="button" data-t="replay" hidden>↺ 重演</button></span></p></footer>
      </div>
      <div class="tr-peek" role="tooltip" hidden></div>
      <section class="tr-detail" role="dialog" aria-label="问题详情" hidden><div class="tr-detail-bg" aria-hidden="true"></div><div class="tr-detail-bar"></div><div class="tr-detail-body"></div><div class="tr-detail-actions"></div></section>
      <p class="tr-sr" aria-live="polite"></p>
    </div></div>`;
  const $ = selector => stage.querySelector(selector);
  const screen = $('.tr-screen'), scroll = $('.tr-scroll'), stackEl = $('.tr-stack'), ledgerEl = $('.tr-ledger');
  const heroEl = $('.tr-hero'), heroN = $('.tr-n'), unitEl = $('.tr-unit'), splitEl = $('.tr-split'), peekEl = $('.tr-peek');
  const panel = $('.tr-detail'), panelBg = $('.tr-detail-bg'), panelBar = $('.tr-detail-bar'), panelBody = $('.tr-detail-body'), panelActions = $('.tr-detail-actions');
  const sr = $('.tr-sr');
  const say = text => { sr.textContent = text; };

  // ---------- this page's answers ----------
  const isAnswer = r => Boolean(r) && r.meaning !== 'ack';
  const answersFor = id => responses.list(s.cursor).filter(r => r.item === id && isAnswer(r)).sort((a, b) => b.at - a.at);
  /** The answer to this question (by its id: a rewrite that registers the same question again keeps it). */
  const answeredRecord = (item, ask) => answersFor(item.id).find(r => (r.ask ? r.ask === ask.id : r.version === item.updated_at)) || null;
  const priorRecord = (item, ask) => answersFor(item.id).find(r => r.ask && r.ask !== ask.id) || null;
  /** The question a record answered, as it was registered (it may have closed since). */
  function askOfRecord(r) {
    for (let j = s.index; j >= 0; j -= 1) { const a = s.frames[j].asks?.[r.item]; if (a?.id === r.ask) return a; }
    return null;
  }
  function answerWords(r, ask) {
    if (r.meaning === 'snooze') return `推到 ${day(r.until)} ${clock(r.until)}`;
    if (r.meaning === 'input') {
      const type = normalizeAsk(ask)?.actions.find(a => a.id === r.action)?.input?.type;
      if (type === 'photo') return `你交了 ${r.value || '照片'}`;
      if (type === 'money') return `你交了 ${r.value}`;
      if (type === 'datetime') return `你定了 ${r.value}`;
      return `你回复「${r.value}」`;
    }
    if (r.meaning === 'act') return `你报告「${r.label}」`;
    return `你选了「${r.label}」`;
  }

  // ---------- what is on the page ----------
  const dueOf = (item, ask) => { const v = ask?.due_at || (item.kind !== 'done' ? item.due_at : null); const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
  function dueWords(due) {
    const ms = due - s.cursor;
    if (ms < 0) return `已过 ${span(ms)}`;
    if (ms < 2 * DAY) return `${shortDate(due) === shortDate(s.cursor) ? '今天' : shortDate(due)} ${formatTime(due)} 前 · 还有 ${span(ms)}`;
    return `${shortDate(due)} 前`;
  }
  /** D's order: the Agent's 档位, then a deadline within a day, then the deadline, share and rank. */
  function urgencyKey({ item, ask }) {
    const due = dueOf(item, ask);
    return [WEIGHT_RANK[item.weight] ?? 2, due != null && due - s.cursor < DAY ? 0 : 1, due ?? Infinity, -item.share, item.rank ?? 0];
  }
  const byUrgency = (a, b) => { const x = urgencyKey(a), y = urgencyKey(b); for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };
  const rootOf = id => kit.rootOf(s.state, id);
  const isRoot = id => s.state.root.items.some(x => x.id === id);
  const nameOf = (id, ask) => scenario.categories?.[id]?.short || (ask ? shortAsk(ask, kit.getItem(s.state, id)) : shortOf(id));
  function openAsks(state, index) {
    const out = [];
    const walk = layer => { for (const item of layer?.items || []) { const ask = kit.currentAsk({ index, state }, item.id); if (ask) out.push({ item, ask }); walk(item.children); } };
    walk(state.root);
    return out;
  }
  function compose() {
    const open = openAsks(s.state, s.index).sort(byUrgency);
    const trays = [], ledger = [];
    let taps = 0, waiting = 0;
    for (const { item, ask } of open) {
      const n = normalizeAsk(ask), e = effortOf(ask), record = answeredRecord(item, ask);
      if (record) {
        const st = responseStatus(record, s.frames, s.cursor);
        if (st.status === 'acknowledged') { if (!known.has(record.key)) ledger.push({ kind: 'mine', id: item.id, item, record, at: Date.parse(st.at) }); continue; }
        trays.push({ item, ask, n, e, record, rows: 0 });
        continue;
      }
      const stepped = e.taps > 1 && steps.has(ask.id);
      const rows = e.taps - (stepped ? 1 : 0);
      trays.push({ item, ask, n, e, stepped, prior: priorRecord(item, ask), rows });
      taps += rows; waiting += 1;
    }
    // Answers given here whose question has since closed: the receipt follows the item into the ledger.
    const placed = new Set([...trays.map(t => t.item.id), ...ledger.map(l => l.id)]);
    const latest = new Map();
    for (const r of responses.list(s.cursor).filter(isAnswer).sort((a, b) => b.at - a.at)) if (!latest.has(r.item)) latest.set(r.item, r);
    for (const [id, record] of latest) {
      if (placed.has(id) || known.has(record.key)) continue;
      const st = responseStatus(record, s.frames, s.cursor);
      if (st.status !== 'acknowledged') continue;
      ledger.push({ kind: 'mine', id, item: kit.getItem(s.state, id), record, at: Date.parse(st.at) });
      placed.add(id);
    }
    // Closed on this 整理 with no answer here: answered at the source, or lapsed with a rewrite.
    if (s.index > 0) {
      for (const { item, ask } of openAsks(s.previousState, s.index - 1)) {
        if (placed.has(item.id) || open.some(x => x.ask.id === ask.id) || known.has(`${item.id}:${ask.id}`)) continue;
        if (responses.list(s.cursor).some(r => r.ask === ask.id)) continue;
        let hit = null;
        for (const event of s.frame.events) { const link = (event.feedback || []).find(l => l.ask === ask.id); if (link) hit = { event, link }; }
        ledger.push({ kind: hit ? 'source' : 'lapsed', id: item.id, item: kit.getItem(s.state, item.id) || item, ask, hit, key: `${item.id}:${ask.id}`, at: Date.parse(s.frame.at) });
        placed.add(item.id);
      }
    }
    ledger.sort((a, b) => b.at - a.at);
    return { trays, ledger, taps, waiting, answered: trays.filter(t => t.record).length };
  }

  // ---------- markup; every leaf has a data-key, every piece of words a data-part ----------
  function deferChoices(now) {
    const morning = nextMorning(now), seen = new Set([morning]);
    const out = [{ label: shortDate(morning) === shortDate(now) ? '今早' : '明早', at: morning }];
    const next = (target, from) => { let m = nextMorning(from); for (let k = 0; k < 9 && weekdayEn.format(m) !== target; k += 1) m = nextMorning(m); return m; };
    for (const [target, label] of [['Mon', '周一'], ['Wed', '周三']]) {
      let at = next(target, now);
      if (seen.has(at)) { at += 7 * DAY; out.push({ label: `下${label}`, at }); } else out.push({ label, at });
      seen.add(at);
    }
    return out;
  }
  /** A moment's name as on the defer chips: 今早 / 明早 for the next two mornings, else the weekday. */
  const momentLabel = (at, now) => {
    if (shortDate(at) === shortDate(now)) return clock(at) < '12:00' ? '今早' : '今天';
    if (shortDate(at) === shortDate(now + DAY)) return clock(at) < '12:00' ? '明早' : '明天';
    return weekday.format(new Date(at));
  };
  /** schedule: the suggested moments, else the next three mornings that still come before the question's deadline. */
  function timeChoices(action, now, due = null) {
    const list = (action.input?.suggestions || []).filter(v => Number.isFinite(Date.parse(v))).map(v => Date.parse(v));
    let at = list;
    if (!at.length) {
      at = [];
      for (let m = nextMorning(now); at.length < 3; m = nextMorning(m)) { if (due != null && m >= due && at.length) break; at.push(m); }
    }
    return at.slice(0, 3).map(t => ({ label: momentLabel(t, now), at: t }));
  }
  const chipInner = (label, sub) => `<i class="tr-dash" aria-hidden="true"></i><i class="tr-ring" aria-hidden="true"></i><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
  /** The rows of a tray (also the detail's controls): one row a tap, the second step drawn dashed until the first is made. */
  function rowsHTML(t, { inDetail = false } = {}) {
    const { item, ask, n, e } = t, id = item.id;
    if (e.kind === 'press') {
      const buttons = e.direct.map(a => {
        const fill = a.recommended || (e.direct.length === 1 && a.meaning === 'act');
        return `<button type="button" class="tr-btn${fill ? ' is-fill' : ''}" data-rs-act="${esc(`${id}:${a.id}`)}">${esc(a.label)}${a.recommended ? '<small>推荐</small>' : ''}</button>`;
      }).join('');
      const extra = e.extra.length && !inDetail ? `<button type="button" class="tr-quiet" data-t-open="${esc(id)}">✎ ${esc(e.extra[0].label)}</button>` : '';
      const write = inDetail ? e.extra.map(a => `<div class="tr-row is-write is-live" data-part="extra-${esc(a.id)}">${fieldHTML(id, a, true)}</div>`).join('') : '';
      return `<div class="tr-row" data-part="press">${buttons}${extra}</div>${write}`;
    }
    if (e.kind === 'chips') {
      const chips = e.chips.map(c => `<button type="button" class="tr-chip is-say" data-rs-pick="${esc(`${id}:${e.action.id}`)}" data-text="${esc(c)}">${chipInner(c)}</button>`).join('');
      const own = e.custom && !inDetail ? `<button type="button" class="tr-quiet" data-t-open="${esc(id)}">✎</button>` : '';
      const write = e.custom && inDetail ? `<div class="tr-row is-write is-live" data-part="extra">${fieldHTML(id, e.action, true)}</div>` : '';
      return `<div class="tr-row is-live" data-part="chips">${chips}${own}</div>${write}`;
    }
    if (e.kind === 'photo') return `<div class="tr-row" data-part="press"><button type="button" class="tr-btn" data-rs-act="${esc(`${id}:${e.action.id}`)}">拍一张</button><span class="tr-then">另要拍照</span></div>`;
    const live = Boolean(t.stepped);
    const first = live ? '' : `<div class="tr-row" data-part="step"><button type="button" class="tr-btn" data-t-step="${esc(id)}">${e.kind === 'write' ? '✎ ' : ''}${esc(e.step)}</button><span class="tr-then">再${esc(e.then)}</span></div>`;
    if (e.kind === 'write') return `${first}<div class="tr-row is-write${live ? ' is-live' : ''}" data-part="write">${fieldHTML(id, e.action, live)}</div>`;
    if (live && custom.has(ask.id)) {
      return `<div class="tr-row is-live is-custom" data-part="custom"><input type="${e.mode === 'defer' ? 'date' : 'datetime-local'}" class="tr-when" data-t-when="${esc(id)}" aria-label="自己挑日子"><button type="button" class="tr-btn is-fill" data-t-when-ok="${esc(id)}">确定</button><button type="button" class="tr-quiet" data-t-custom="${esc(id)}" aria-label="收起">×</button></div>`;
    }
    const choices = e.mode === 'defer' ? deferChoices(s.cursor) : timeChoices(e.action, s.cursor, dueOf(item, ask));
    const chip = c => live
      ? `<button type="button" class="tr-chip" data-t-pick="${esc(id)}" data-at="${c.at}">${chipInner(c.label, `${shortDate(c.at)} ${clock(c.at)}`)}</button>`
      : `<span class="tr-chip is-pending" data-t-pend="${esc(id)}" aria-hidden="true">${chipInner(c.label, `${shortDate(c.at)} ${clock(c.at)}`)}</span>`;
    const own = live ? `<button type="button" class="tr-chip is-own" data-t-custom="${esc(id)}">${chipInner(e.mode === 'defer' ? '挑日子' : '自定义')}</button>`
      : `<span class="tr-chip is-own is-pending" data-t-pend="${esc(id)}" aria-hidden="true">${chipInner(e.mode === 'defer' ? '挑日子' : '自定义')}</span>`;
    return `${first}<div class="tr-row${live ? ' is-live' : ''}" data-part="pick">${choices.map(chip).join('')}${own}</div>`;
  }
  /** A one-line field and its send button; drawn dashed (inert) until the first tap opens it. The words stay the same. */
  function fieldHTML(id, action, live) {
    const key = `${id}:${action.id}`, money = action.input?.type === 'money';
    const ph = money ? '填一个数' : '写一句…';
    if (!live) return `<span class="tr-field is-pending" aria-hidden="true"><i class="tr-dash"></i><i class="tr-ring"></i><span class="tr-ph">${ph}</span></span><span class="tr-send is-pending" aria-hidden="true"><i class="tr-dash"></i><i class="tr-ring"></i>↑</span>`;
    return `<span class="tr-field"><i class="tr-dash" aria-hidden="true"></i><i class="tr-ring" aria-hidden="true"></i><input type="${money ? 'number' : 'text'}" data-rs-text="${esc(key)}" placeholder=" " enterkeyhint="send" aria-label="${esc(action.label || '回一句')}"><span class="tr-ph" aria-hidden="true">${ph}</span></span><button type="button" class="tr-send" data-rs-send="${esc(key)}" aria-label="发出"><i class="tr-dash" aria-hidden="true"></i><i class="tr-ring" aria-hidden="true"></i>↑</button>`;
  }
  function metaWords(t) {
    const { item, ask } = t, due = dueOf(item, ask), parts = [];
    if (t.prior) parts.push('答过上一版');
    parts.push(WEIGHT_NAME[item.weight] || item.weight);
    parts.push(due != null ? dueWords(due) : '没有期限');
    if (isRoot(item.id)) parts.push(`${item.share} 份`);
    return parts.join(' · ');
  }
  const isNew = ask => ask.frameIndex === s.index && Date.parse(ask.registered_at) === Date.parse(s.frame.at);
  function trayHTML(t) {
    const { item, ask, e } = t, id = item.id, title = shortAsk(ask, item);
    if (t.record) {
      return `<article class="tr-tray is-receipt" data-key="i:${esc(id)}" data-id="${esc(id)}" tabindex="0" aria-label="${esc(`已回应：${title}`)}">
        ${receiptPart(nameOf(id, ask), answerWords(t.record, ask), '已保存', 'saved')}<button type="button" class="tr-undo" data-rs-undo="${esc(id)}">撤回</button></article>`;
    }
    const tag = t.stepped ? `<button type="button" class="tr-tag" data-part="tag" data-t-unstep="${esc(id)}" aria-label="${esc(`退回第一下：${e.step}`)}">${esc(e.step)}<span aria-hidden="true">×</span></button>` : '';
    return `<article class="tr-tray rows-${t.rows}" data-key="i:${esc(id)}" data-id="${esc(id)}"${isNew(ask) ? ' data-new=""' : ''} tabindex="0" aria-label="${esc(`${title}：最少 ${t.rows} 下`)}">
      <div class="tr-top"><p class="tr-title" data-part="title"><i class="tr-sq" aria-hidden="true"></i><span>${esc(title)}</span></p>${tag}</div>
      <p class="tr-meta" data-part="meta">${esc(metaWords(t))}</p>
      ${rowsHTML(t)}
      <p class="tr-side" data-part="count"><b>${t.rows}</b><small>下</small></p></article>`;
  }
  function receiptPart(name, words, state, status) {
    const glyph = status === 'source' ? '↩' : status === 'lapsed' ? '–' : '✓';
    return `<p class="tr-receipt is-${status}" data-part="receipt"><span class="tr-check" aria-hidden="true">${glyph}</span><span class="tr-rt"><b>${esc(name)}</b> · ${esc(words)}</span><small>${esc(state)}</small></p>`;
  }
  function lineHTML(l) {
    const id = l.id, name = nameOf(id, l.kind === 'mine' ? askOfRecord(l.record) : l.ask);
    let part;
    if (l.kind === 'mine') part = receiptPart(name, answerWords(l.record, askOfRecord(l.record)), `已收到 ${formatTime(l.at)}`, 'acknowledged');
    else if (l.kind === 'source') part = receiptPart(name, responseSentence(l.hit.event, l.hit.link), '问题关上', 'source');
    else part = receiptPart(name, `「${shortAsk(l.ask, l.item)}」随改写失效`, '', 'lapsed');
    return `<article class="tr-line is-${l.kind}" data-key="i:${esc(id)}" data-id="${esc(id)}" data-swipe="${esc(l.kind === 'mine' ? l.record.key : l.key)}" tabindex="0">${part}</article>`;
  }

  // ---------- keyed patch ----------
  const toNode = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
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
  // How each kind of leaf looks as a box (d-motion.mjs makeBox): the ring is var(--line), set on the screen.
  function lookFor(el) {
    if (el.matches('.tr-tray.is-receipt')) return { key: 'receipt', bg: 'var(--tr-receipt)', r: 14, ring: true };
    if (el.matches('.tr-tray')) return { key: 'tray', bg: 'var(--tr-card)', r: 18, ring: true };
    if (el.matches('.tr-line')) return { key: 'line', bg: 'var(--tr-paper)', r: 1, rule: true };
    if (el.matches('.tr-detail')) return { key: 'detail', bg: 'var(--tr-paper)', r: 1 };
    return null;
  }
  const measure = el => { const m = measureEl(el, 1); m.look = lookFor(el); return m; };
  const TOP = '.tr-stack > [data-key], .tr-ledger > [data-key]';
  function measureAll() {
    const map = new Map();
    for (const el of scroll.querySelectorAll(TOP)) map.set(el.dataset.key, measure(el));
    return map;
  }
  const homeEl = id => id && scroll.querySelector(`[data-key="i:${CSS.escape(id)}"]`);
  // Scroll anchoring by hand (Safari has none): what you read, or what you just acted on, stays where it was.
  function pickAnchor(prefer) {
    if (scroll.scrollTop <= 0) return null;
    const top = scroll.getBoundingClientRect().top, list = [...scroll.querySelectorAll(TOP)];
    const el = (prefer && list.find(x => x.dataset.key === prefer)) || list.find(x => x.getBoundingClientRect().bottom > top + 1);
    return el ? { key: el.dataset.key, top: el.getBoundingClientRect().top } : null;
  }
  function keepAnchor(a) {
    const el = a && scroll.querySelector(`[data-key="${CSS.escape(a.key)}"]`);
    if (!el) return;
    const d = el.getBoundingClientRect().top - a.top;
    if (Math.abs(d) >= 0.5) scroll.scrollTop += d;
  }

  // ---------- beats: every animation of one moment, ended together ----------
  let pinned = null;
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
    for (const a of screen.getAnimations({ subtree: true })) {
      if (pinned == null) { if (a.playState === 'paused') a.play(); } else { a.pause(); a.currentTime = pinned * 1000; }
    }
    if (pinned == null) for (const c of [beat, detail.ctx, peekOut]) if (c && !c.done && c.anims.every(a => a.playState === 'finished')) settle(c);
  }

  let beat = null, view = null;
  /** Patch the page, then play the beat `name` from where things were to where they are now. */
  function update(name, opts = {}) {
    const B = BEATS[name] || null;
    const animate = Boolean(B) && !quiet && !reduced() && !document.hidden && scroll.offsetParent !== null;
    const before = animate ? measureAll() : null;
    settle(beat); beat = null;
    const anchor = pickAnchor(opts.target ? `i:${opts.target}` : null);
    const removed = new Map(), replaced = new Map();
    const focus = focusMark();
    patch(stackEl, view.trays, removed, replaced);
    patch(ledgerEl, view.ledger, removed, replaced);
    const fx = renderHead(view.head);
    markNew(animate ? B.glow : 0.25);
    restoring = true; restoreFocus(focus); restoring = false;
    restoreDrafts();
    keepAnchor(anchor);
    const ctx = beat = newCtx();
    if (!animate) { settle(ctx); beat = null; return; }
    const after = measureAll();
    const hosts = new Map([stackEl, ledgerEl].map(x => [x, x.getBoundingClientRect()]));
    choreograph(ctx, B, name, { before, after, removed, replaced, opts, hosts });
    // The head's numbers turn over together at the hero moment: the big one rolls, the line beside it flips in that
    // frame, and the split underneath crossfades (the old words stay until then, so the two never disagree).
    if (fx.roll) roll(ctx, heroN, fx.roll.before, fx.roll.after, B.hero);
    if (fx.unit) swapAt(ctx, unitEl, fx.unit, B.hero, false);
    if (fx.split) swapAt(ctx, splitEl, fx.split, B.hero, true);
    arm(ctx);
  }
  /** Who moves in which group (trays-motion.md 3.2–3.4; D's home-motion.md 4.3). */
  function choreograph(ctx, B, name, { before, after, removed, replaced, opts, hosts }) {
    for (const [key, node] of removed) if (after.has(key)) { replaced.set(key, node); removed.delete(key); }
    const selves = new Set((opts.targets || (opts.target ? [opts.target] : [])).map(id => `i:${id}`));
    // A landing's protagonists: receipts first, then the trays that closed, sinking into the ledger 0.06 s apart.
    const leads = new Map();
    if (name === 'turn') {
      const list = [];
      for (const [key, now] of after) {
        const was = before.get(key);
        if (!was || !key.startsWith('i:')) continue;
        if (was.zone.includes('tr-stack') && now.zone.includes('tr-ledger')) list.push({ key, mine: was.el.matches('.is-receipt'), top: now.top });
      }
      list.sort((a, b) => (b.mine - a.mine) || (a.top - b.top)).forEach((x, j) => leads.set(x.key, { ...x, j }));
    }
    const entering = [];
    for (const [key, now] of after) {
      const was = before.get(key);
      if (!was) { entering.push([key, now]); continue; }
      const el = now.el, old = replaced.get(key) || null, lead = leads.get(key), self = selves.has(key) && B.self;
      let t;
      if (self) {
        const S = B.self;
        t = { move: S.box, box: S.box, parts: S.box, out: S.out, in: S.in, fresh: S.in, flip: B.hero, settle: S.box[0] + S.box[1] };
      } else if (lead) {
        // The box turns from a receipt into a line on the paper as it travels (a receipt and a line look alike, so
        // there is no card look to keep for the first half, as D keeps for its cards).
        const d = lead.j * B.leadStep, span = [B.lead[0] + d, B.lead[1]];
        t = { move: span, box: span, parts: span, out: [span[0], 0.12], in: span, fresh: span, flip: B.flip, settle: span[0] + span[1], z: 3 + leads.size - lead.j, ease: EASE_IN_OUT };
      } else {
        t = { move: B.move, box: B.move, parts: B.move, out: [B.move[0], B.move[1] * 0.4], in: B.swap, fresh: B.fresh, flip: B.flip, settle: B.settle, z: now.top < was.top - 0.5 ? 2 : 0 };
      }
      // On a landing every word turns over at the cut (dates, deadlines, 已保存 → 已收到); only boxes and places move.
      if (name === 'turn') t.keep = ALL;
      morph(ctx, { el, was, now, old, k: 1, t, hostRect: hosts.get(el.parentElement) });
      if (self && name === 'answer') { const check = el.querySelector('.tr-check'); play(ctx, check, [{ opacity: 0, transform: 'scale(.55)' }, { opacity: 1, transform: 'none' }], [0.12, 0.18]); }
      // The second row of a two-step tray turns from dashed to solid as it rises (and back on the way out).
      if (self && (name === 'step' || name === 'unstep')) {
        const live = name === 'step', S = B.self;
        for (const ring of el.querySelectorAll('.tr-row .tr-ring')) play(ctx, ring, live ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], S.in, { easing: 'linear' });
        for (const dash of el.querySelectorAll('.tr-row .tr-dash')) play(ctx, dash, live ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }], S.in, { easing: 'linear' });
      }
      if (lead?.mine) fillCheck(ctx, el, B.receipt);
      if (opts.swipe && key === `i:${opts.swipe.key}`) play(ctx, el, [{ transform: `translateX(${opts.swipe.dx}px)` }, { transform: 'none' }], [0, 0.20]);
    }
    // Leaving: swiped rows go on to the left from where the finger left them; the rest lift and fade.
    for (const [key, node] of removed) {
      const was = before.get(key);
      if (!was) continue;
      const g = ghostOf(node, was, 1, was.host, 0, hosts.get(was.host));
      ctx.clean(() => g.remove());
      g.style.transformOrigin = 'top center';
      if (opts.swipe && node.dataset.swipe === opts.swipe.key) play(ctx, g, [{ transform: `translateX(${opts.swipe.dx}px)`, opacity: 1 }, { transform: `translateX(${-was.width}px)`, opacity: 0 }], [0, 0.20], { easing: EASE_IN });
      else play(ctx, g, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-4px) scale(.985)' }], B.exit, { easing: EASE_IN });
    }
    // Arriving, 40 ms apart, revealed from the top edge down.
    entering.forEach(([, now], n) => reveal(ctx, now.el, [B.enter[0] + Math.min(n, STAGGER_MAX) * STAGGER, B.enter[1]]));
  }
  /** A receipt the Agent has now read: the hollow check fills (0–0.30 s, before anything moves). */
  function fillCheck(ctx, el, at) {
    const receipt = el.querySelector('.tr-receipt.is-acknowledged'), check = receipt?.querySelector('.tr-check');
    if (!check) return;
    receipt.classList.add('is-filling');
    const dot = document.createElement('i');
    dot.className = 'tr-check-fill';
    dot.textContent = '✓';
    check.append(dot);
    play(ctx, dot, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], at);
    ctx.clean(() => { dot.remove(); receipt.classList.remove('is-filling'); });
  }
  /** A question registered on this round: its outline is drawn once in vermilion, `delay` seconds after the cut. */
  function markNew(delay) {
    for (const tray of stackEl.querySelectorAll('.tr-tray[data-new]')) {
      const key = `${s.index}:${tray.dataset.id}`;
      if (pulsed.has(key)) continue;
      pulsed.add(key);
      tray.style.setProperty('--glow-delay', `${delay}s`);
      tray.classList.add('is-pulse');
      tray.addEventListener('animationend', () => tray.classList.remove('is-pulse'), { once: true });
    }
  }
  // Keep keyboard focus and unsent words across re-renders.
  const FOCUS_ATTRS = ['data-rs-act', 'data-rs-pick', 'data-rs-undo', 'data-rs-send', 'data-rs-text', 'data-t-step', 'data-t-unstep', 'data-t-pick', 'data-t-custom', 'data-t-open', 'data-t-when'];
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
    const target = (mark.attrs && !mark.self && (leaf || scroll).querySelector(mark.attrs)) || leaf?.querySelector('[data-rs-undo], [data-rs-text], button') || leaf;
    target?.focus({ preventScroll: true });
  }
  const restoreDrafts = () => { for (const box of screen.querySelectorAll('[data-rs-text]')) { const v = drafts.get(box.dataset.rsText); if (v && !box.value) box.value = v; } };

  // ---------- head ----------
  function headView(v) {
    const count = v.waiting, open = v.trays.length;
    const twos = v.trays.filter(t => !t.record && t.rows > 1), ones = v.trays.filter(t => !t.record && t.rows === 1);
    const stepped = v.trays.filter(t => t.stepped);
    let split;
    if (!open && !v.ledger.length) split = s.index === 0 ? '还没有整理过任何输入。' : '此刻没有要你回应的事。';
    else if (!count) split = v.answered ? `都答了 · ${v.answered} 个回执等 Agent 下一轮整理读到` : '此刻没有开着的问题。';
    else {
      const parts = [];
      const oneWord = ones.length === count ? (count === 1 ? '点一下就完' : `${count} 个都是点一下就完`) : `${ones.length} 个点一下就完`;
      if (ones.length) parts.push(oneWord);
      if (twos.length === 1) { const t = twos[0]; parts.push(`「${shortAsk(t.ask, t.item)}」要两下：${pathWords(t.e)}`); }
      else if (twos.length > 1) parts.push(`${twos.length} 个要两下：先点开，再挑或写`);
      if (stepped.length) parts.push(`${stepped.map(t => `「${shortAsk(t.ask, t.item)}」`).join('')}点过第一下了`);
      if (v.answered) parts.push(`已答 ${v.answered} 个，等下一轮整理`);
      split = `${parts.join('；')}。`;
    }
    const at = new Date(s.cursor);
    const head = {
      kick: `第 ${s.index} / ${last} 轮 · ${dayLong.format(at)} ${weekday.format(at)} ${formatTime(at)}`,
      n: count ? v.taps : 0, u1: count ? '下答完' : open ? '下 · 都答了' : '下', of: count ? `${count} 个问题` : open ? `${open} 个回执` : '没有要你回应的事',
      split, label: count ? `${v.taps} 下答完 ${count} 个问题` : open ? '都答了' : '没有要你回应的事',
    };
    head.sig = [head.kick, head.n, head.u1, head.of, head.split].join('|');
    return head;
  }
  let headSig = '';
  function renderHead(h) {
    headSig = h.sig;
    $('.tr-kick').textContent = h.kick;
    const count = heroN.querySelector('.d-count'), before = count.textContent;
    count.textContent = String(h.n);
    const unitBefore = unitEl.innerHTML;
    $('.tr-u1').textContent = h.u1; $('.tr-of').textContent = h.of;
    heroEl.setAttribute('aria-label', h.label);
    const splitBefore = splitEl.textContent;
    splitEl.textContent = h.split;
    return { roll: before !== String(h.n) && before !== '' ? { before, after: String(h.n) } : null,
      unit: unitBefore !== unitEl.innerHTML && before !== '' ? unitBefore : null,
      split: splitBefore !== h.split && splitBefore ? esc(splitBefore) : null };
  }
  /** The old words stay on a copy over the new ones until `at`, then turn over in one frame (or crossfade). */
  function swapAt(ctx, el, oldHTML, at, fade) {
    const g = el.cloneNode(false);
    g.innerHTML = oldHTML;
    g.classList.add('tr-was');
    g.setAttribute('aria-hidden', 'true');
    g.removeAttribute('aria-live');
    Object.assign(g.style, { position: 'absolute', left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, width: `${el.offsetWidth}px`, margin: '0', pointerEvents: 'none' });
    el.after(g);
    ctx.clean(() => g.remove());
    if (fade) {
      // Two different sentences do not crossfade (mid-way they smear into each other): one out, then the other in.
      play(ctx, g, [{ opacity: 1 }, { opacity: 0 }], [at, 0.10], { easing: 'linear' });
      play(ctx, el, [{ opacity: 0 }, { opacity: 1 }], [at + 0.08, 0.20], { easing: 'linear' });
    } else { stepAt(ctx, g, at, false); stepAt(ctx, el, at, true); }
  }
  function buildView() {
    const v = compose();
    const trays = v.trays.length ? v.trays.map(t => ({ key: `i:${t.item.id}`, html: trayHTML(t) }))
      : [{ key: 'empty', html: `<div class="tr-empty" data-key="empty"><p>${v.ledger.length ? '托盘都让出来了' : '没有托盘'}</p><span>${s.index === 0 ? '还没有整理过任何输入。' : '此刻没有开着的问题。'}</span></div>` }];
    const ledger = v.ledger.length ? [{ key: 'h:ledger', html: `<h2 class="tr-ledger-head" data-key="h:ledger"><span data-part="count">已收到与关上 · ${v.ledger.length}</span></h2>` }, ...v.ledger.map(l => ({ key: `i:${l.id}`, html: lineHTML(l) }))] : [];
    return { v, trays, ledger, head: headView(v) };
  }
  /** name: which beat to play — none (first paint), turn, answer, step, unstep, undo, local. */
  function render(name = 'local', opts = {}) {
    if (disposed) return;
    view = buildView();
    if (name === 'none' || !(same(stackEl, view.trays) && same(ledgerEl, view.ledger) && headSig === view.head.sig)) update(name, opts);
    renderKeys();
    renderSide();
    if (detail.id) refreshDetail();
  }

  // ---------- the concept card's side: the rule, and this round's taps ----------
  function renderSide() {
    if (!kit.side) return;
    const v = view.v;
    kit.side.innerHTML = `<h3 class="tr-legend-title">此刻 · ${v.taps} 下答完 ${v.waiting} 个问题</h3>
      <ol class="tr-legend">${v.trays.map(t => `<li><span>${t.record ? '✓' : t.rows}</span>${esc(shortAsk(t.ask, t.item))}<small>${esc(t.record ? answerWords(t.record, t.ask) : pathWords(t.e))}</small></li>`).join('') || '<li><span>0</span>没有开着的问题</li>'}</ol>
      <p class="tr-legend-note">${esc(RULE)}</p>`;
  }

  // ---------- answering ----------
  let lastDown = null, guard = null;
  function give(item, action, extra = {}, opts = {}) {
    if (!item) return null;
    const ask = kit.currentAsk(s, item.id);
    if (playing) setPlaying(false); // what you just pressed is not swept away by the next round
    if (ask) { steps.delete(ask.id); custom.delete(ask.id); }
    const record = responses.save(item, action, { ask, at: s.cursor, ...extra });
    for (const key of [...drafts.keys()]) if (key.startsWith(`${item.id}:`)) drafts.delete(key);
    say(`已保存 · ${answerWords(record, ask)}`);
    if (lastDown && performance.now() - lastDown.t < 900 && !opts.tour) guard = { x: lastDown.x, y: lastDown.y, id: item.id, until: performance.now() + BEATS.answer.guard * 1000 };
    render('answer', { target: item.id });
    return record;
  }
  function stepTray(id, on = true) {
    const ask = kit.currentAsk(s, id), e = ask && effortOf(ask);
    if (!ask || e.taps < 2 || answeredRecord({ id, updated_at: kit.getItem(s.state, id)?.updated_at }, ask)) return;
    if (on === steps.has(ask.id)) return;
    if (on) steps.add(ask.id); else { steps.delete(ask.id); custom.delete(ask.id); }
    say(on ? `点了「${e.step}」，还差一下` : '退回第一下');
    render(on ? 'step' : 'unstep', { target: id });
    if (on && e.kind === 'write') homeEl(id)?.querySelector('[data-rs-text]')?.focus({ preventScroll: true });
  }
  function undo(id, opts = {}) {
    const item = kit.getItem(s.state, id), ask = kit.currentAsk(s, id);
    const record = item && ask ? answeredRecord(item, ask) : answersFor(id)[0];
    if (!record) return;
    responses.removeKey(record.key);
    say('已撤回');
    render('undo', { target: id, ...opts });
  }
  const unbindResponses = bindResponses(screen, {
    drafts,
    ask: id => kit.currentAsk(s, id),
    respond(target, action, { value, until } = {}) { give(kit.getItem(s.state, target), action, { value, until }); },
    open() {}, // every control lives in its tray; there are no sheets on this page
    undo: target => undo(target),
  });
  screen.addEventListener('input', event => { const box = event.target.closest?.('[data-rs-text]'); if (box) drafts.set(box.dataset.rsText, box.value); });

  // ---------- the detail grows out of the tray you tapped and shrinks back into it ----------
  const detail = { id: null, origin: null, ctx: null, rig: null, pushed: false, instant: false, dragQ: null, ignorePop: 0, landed: null };
  const setHTML = (el, html) => { if (el.__html === html) return false; el.__html = html; el.innerHTML = html; return true; };
  function sourceHTML(src) {
    const e = src.ref?.startsWith('event:') ? kit.findEvent(src.ref.slice(6)) : null;
    const author = src.author || e?.from || '';
    const quote = src.quote || (e?.text ? `${e.text.slice(0, 160)}${e.text.length > 160 ? '…' : ''}` : '');
    return `<article class="tr-source"><small>${esc(author)} · ${esc(src.channel || e?.channel || '')}${e ? ` · ${esc(stamp(e.at))}` : ''}</small>${quote ? `<p lang="${/[一-鿿]/.test(quote) ? 'zh' : 'en'}">${esc(quote)}</p>` : ''}</article>`;
  }
  function ixSections(item) {
    if (!isRoot(item.id)) return '';
    const t = document.createElement('template');
    t.innerHTML = ixDetailHTML(itemFacts(s.index, item.id), { last, href: '', trendH: 28 });
    const keep = [...t.content.querySelectorAll('section')].filter(x => /^(份额|本轮进了它)/.test(x.querySelector('h5')?.textContent || ''));
    return keep.length ? `<div class="tr-ixsec">${keep.map(x => x.outerHTML).join('')}</div>` : '';
  }
  function detailParts(id) {
    const item = kit.getItem(s.state, id), v = view.v;
    const tray = v.trays.find(t => t.item.id === id), line = v.ledger.find(l => l.id === id);
    const ask = tray?.ask || (line?.kind === 'mine' ? askOfRecord(line.record) : line?.ask) || null;
    const parent = item?.parent_id && kit.getItem(s.state, item.parent_id);
    const share = item ? (isRoot(id) ? `${item.share} / 64` : `${item.share} / 64 · ${esc(parent?.title || '')}`) : '';
    const bar = `<button type="button" data-t="back" aria-label="收回（Esc）">‹</button><span>${esc(parent ? parent.title : '回应托盘')}</span><span class="tr-detail-share">${share}</span>`;
    const e = ask ? effortOf(ask) : null, n = ask ? normalizeAsk(ask) : null;
    const due = item && ask ? dueOf(item, ask) : null;
    const facts = item ? [`档位 ${WEIGHT_NAME[item.weight] || item.weight}`, `${item.share} 份`, kit.kindLabel[item.kind]] : [];
    if (due != null) facts.push(dueWords(due));
    if (ask) { const waited = s.cursor - Date.parse(ask.registered_at); facts.push(waited < HOUR ? '本轮登记的问题' : `问题已开 ${span(waited)}`); }
    const howMany = tray && !tray.record
      ? `<p><b>${tray.rows} 下</b>：${esc(pathWords(e))}${tray.stepped ? '；第一下已经点过' : ''}。</p>`
      : tray?.record ? `<p>已答：${esc(answerWords(tray.record, ask))}，用了 ${e.taps} 下。</p>`
        : line?.kind === 'mine' ? `<p>已答：${esc(answerWords(line.record, ask))}，Agent 已读到。</p>`
          : line ? `<p>这个问题已关上：${esc(line.kind === 'source' ? responseSentence(line.hit.event, line.hit.link) : '随改写失效')}。</p>` : '';
    const trail = item ? kit.feedbackTrail(s, id).flatMap(t => t.links.map(l => ({ at: t.event.at, text: responseSentence(t.event, l) }))).slice(-4).reverse() : [];
    const body = `<p class="tr-d-k">${ask ? `<i class="tr-sq" aria-hidden="true"></i>${esc(MEANING[n.meanings[0]] || '等你回应')}` : esc(kit.kindLabel[item?.kind] || '')}</p>
      <h2>${esc(ask?.prompt || item?.title || line?.record?.title || id)}</h2>
      ${ask && item ? `<p class="tr-d-title">${esc(item.title)}</p>` : ''}
      ${item ? `<section class="tr-d-why"><h4>为什么在这里</h4><p class="tr-d-facts">${facts.map(x => `<span>${esc(x)}</span>`).join('')}</p><p>${esc(item.summary || '')}</p>${item.reason ? `<p class="tr-d-reason">${esc(item.reason)}</p>` : ''}</section>` : ''}
      <section class="tr-d-taps"><h4>这一问要几下</h4>${howMany}<p class="tr-d-sum">此刻 ${v.waiting} 个问题合计 ${v.taps} 下。</p><p class="tr-d-rule">${esc(RULE)}</p></section>
      ${item ? ixSections(item) : ''}
      ${trail.length ? `<section><h4>你在原处做过的</h4>${trail.map(x => `<p class="tr-d-loop"><time>${esc(stamp(x.at))}</time> ${esc(x.text)}</p>`).join('')}</section>` : ''}
      ${item?.sources?.length ? `<section><h4>依据 · ${item.sources.length} 条</h4>${item.sources.slice(0, 3).map(sourceHTML).join('')}</section>` : ''}
      <button type="button" class="tr-d-json" data-inspect="state">核对完整状态 JSON ↗</button>`;
    let actions = '';
    if (tray?.record) actions = `${receiptPart(nameOf(id, ask), answerWords(tray.record, ask), '已保存 · 等 Agent 下一轮整理', 'saved')}<button type="button" class="tr-undo" data-rs-undo="${esc(id)}">撤回</button>`;
    else if (tray) actions = rowsHTML(tray, { inDetail: true });
    else if (line?.kind === 'mine') actions = `${receiptPart(nameOf(id, ask), answerWords(line.record, ask), `已收到 · Agent 在 ${formatTime(line.at)} 的整理中读到`, 'acknowledged')}<button type="button" class="tr-undo" data-rs-undo="${esc(id)}">撤回</button>`;
    return { bar, body, actions };
  }
  function fillDetail(parts) {
    let changed = false;
    for (const [el, html] of [[panelBar, parts.bar], [panelBody, parts.body], [panelActions, parts.actions]]) changed = setHTML(el, html) || changed;
    panelActions.hidden = !parts.actions;
    restoreDrafts();
    return changed;
  }
  function refreshDetail() {
    if (!detail.id) return;
    if (!homeEl(detail.id) && !kit.getItem(s.state, detail.id)) { closeDetail(true); return; }
    const top = panelBody.scrollTop;
    fillDetail(detailParts(detail.id));
    panelBody.scrollTop = top;
  }
  function makeRig(origin) {
    panel.classList.add('is-growing');
    const P = panel.getBoundingClientRect(), O = origin.getBoundingClientRect();
    const W = P.width, H = P.height, ow = O.width, oh = O.height, sc = (ow + 8) / ow;
    const popped = { x: O.left - P.left - (ow * (sc - 1)) / 2, y: O.top - P.top - (oh * (sc - 1)) / 2, w: ow * sc, h: oh * sc };
    const full = { x: 0, y: 0, w: W, h: H };
    const base = Math.max(W, popped.w);
    // Both boxes share one rect; the tray's look lies on the paper and fades into it, so the frame is never see-through.
    const card = makeBox(panel, lookFor(origin) || { key: 'tray', bg: 'var(--tr-card)', r: 18, ring: true }, base);
    const paper = makeBox(panel, lookFor(panel), base);
    const face = origin.cloneNode(true);
    for (const a of ['data-key', 'data-id', 'tabindex', 'id']) face.removeAttribute(a);
    face.querySelectorAll('[data-key], [id]').forEach(x => { x.removeAttribute('data-key'); x.removeAttribute('id'); });
    face.classList.remove('is-focus', 'is-pressing', 'is-lifted', 'is-pulse');
    face.classList.add('d-ghost', 'is-face', 'tr-face');
    face.setAttribute('inert', '');
    Object.assign(face.style, { position: 'absolute', left: `${O.left - P.left}px`, top: `${O.top - P.top}px`, width: `${ow}px`, height: `${oh}px`, margin: '0', transform: `scale(${sc})`, transformOrigin: '50% 50%', opacity: '0' });
    panel.insertBefore(face, panelBar);
    const content = [panelBar, ...panelBody.children];
    return { origin, popped, full, sc, paper, card, face, content, remove() { paper.remove(); card.remove(); face.remove(); panel.classList.remove('is-growing'); } };
  }
  function dim(origin) {
    scroll.querySelectorAll('.is-focus').forEach(x => x !== origin && x.classList.remove('is-focus'));
    origin?.classList.add('is-focus');
    scroll.style.setProperty('--undim-delay', '0s');
    scroll.classList.toggle('is-dim', Boolean(origin));
  }
  function undim(delay) {
    scroll.style.setProperty('--undim-delay', `${delay}s`);
    scroll.classList.remove('is-dim');
    scroll.querySelectorAll('.is-focus').forEach(x => x.classList.remove('is-focus'));
  }
  function openDetail(id, origin = null) {
    if (!id || id === 'hero' || (!homeEl(id) && !kit.getItem(s.state, id))) return;
    if (detail.id === id) return;
    if (peekState) hidePeek(true);
    holdPlay();
    settle(detail.ctx);
    detail.id = id;
    detail.origin = origin || homeEl(id);
    fillDetail(detailParts(id));
    panelBody.scrollTop = 0;
    panel.hidden = false;
    panel.classList.remove('is-leaving');
    pushDetail();
    panelBar.querySelector('[data-t="back"]')?.focus({ preventScroll: true });
    const from = detail.origin;
    if (!from || reduced() || document.hidden) return;
    const ctx = detail.ctx = newCtx(), R = detail.rig = makeRig(from);
    dim(from);
    const t1 = GROW.frame[0] + GROW.frame[1];
    play(ctx, from, popKeys(1, R.sc), GROW.pop, { easing: 'linear' });
    R.card.animate(ctx, R.popped, R.full, GROW.frame);
    R.paper.animate(ctx, R.popped, R.full, GROW.frame);
    const a = GROW.frame[0] / t1;
    play(ctx, R.card.el, [{ opacity: 0 }, { opacity: 0, offset: a - 0.001 }, { opacity: 1, offset: a }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], [0, t1], { easing: 'linear' });
    play(ctx, R.paper.el, [{ opacity: 0 }, { opacity: 0, offset: a - 0.001 }, { opacity: 1, offset: a }, { opacity: 1 }], [0, t1], { easing: 'linear' });
    const fe = GROW.face[0] + GROW.face[1];
    play(ctx, R.face, [{ opacity: 0 }, { opacity: 0, offset: GROW.face[0] / fe - 0.001 }, { opacity: 1, offset: GROW.face[0] / fe }, { opacity: 0 }], [0, fe], { easing: 'linear' });
    for (const el of R.content) play(ctx, el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], GROW.content);
    play(ctx, panelActions, [{ opacity: 0, transform: 'translateY(100%)' }, { opacity: 1, transform: 'none' }], GROW.content);
    play(ctx, panelBg, [{ opacity: 0 }, { opacity: 1 }], GROW.content, { easing: 'linear' });
    arm(ctx, () => { R.remove(); if (detail.rig === R) detail.rig = null; });
  }
  function closeDetail(instantly = false) {
    const id = detail.id;
    if (!id) return;
    detail.id = null;
    popDetailHistory();
    const instant = instantly || detail.instant || reduced() || document.hidden || panel.hidden;
    detail.instant = false;
    const q = detail.dragQ;
    detail.dragQ = null;
    if (q == null) settle(detail.ctx);
    const origin = (detail.origin?.isConnected && detail.origin.dataset.id === id ? detail.origin : homeEl(id)) || null;
    detail.origin = null;
    const done = () => {
      if (detail.id) return;
      panel.hidden = true;
      panel.classList.remove('is-leaving', 'is-growing');
      for (const el of [panelBar, panelBody, panelActions]) { el.__html = undefined; el.innerHTML = ''; el.style.opacity = ''; el.style.transform = ''; }
      panelBg.style.opacity = '';
      if (!peekState) undim(0);
      restoring = true; origin?.focus({ preventScroll: true }); restoring = false;
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
    if (!origin.classList.contains('is-focus')) dim(origin);
    const f = q == null ? 1 : Math.max(0.45, q);
    const sp = ([a, d]) => [a * f, d * f];
    const from = q == null ? R.full : lerpRect(R.popped, R.full, q);
    const cur = el => Number(el.style.opacity || (q == null ? 1 : 0));
    for (const el of R.content) play(ctx, el, [{ opacity: q == null ? 1 : cur(el), transform: 'none' }, { opacity: 0, transform: 'none' }], sp(SHRINK.content), { easing: 'linear' });
    play(ctx, panelActions, [{ opacity: q == null ? 1 : cur(panelActions) }, { opacity: 0 }], sp(SHRINK.content), { easing: 'linear' });
    play(ctx, panelBg, [{ opacity: q == null ? 1 : cur(panelBg) }, { opacity: 0 }], sp(SHRINK.content), { easing: 'linear' });
    R.card.animate(ctx, from, R.popped, sp(SHRINK.frame), EASE_IN_OUT);
    R.paper.animate(ctx, from, R.popped, sp(SHRINK.frame), EASE_IN_OUT);
    R.paper.el.style.opacity = '1';
    play(ctx, R.card.el, [{ opacity: q == null ? 0 : cur(R.card.el) }, { opacity: 1 }], sp([SHRINK.frame[0], SHRINK.frame[1] * 0.4]), { easing: 'linear' });
    play(ctx, R.face, [{ opacity: q == null ? 0 : cur(R.face) }, { opacity: 1 }], sp(SHRINK.face), { easing: 'linear' });
    const landed = SHRINK.pop[0] * f;
    stepAt(ctx, panel, landed, false);
    play(ctx, origin, [{ transform: `scale(${R.sc})` }, { transform: 'none' }], [landed, SHRINK.pop[1]], { easing: EASE_IN_OUT });
    undim(landed);
    arm(ctx, () => { R.remove(); if (detail.rig === R) detail.rig = null; done(); });
  }
  // Pull the detail down when it is scrolled to the top: the frame follows the finger back toward its tray.
  function dragState(q) {
    const R = detail.rig;
    if (!R) return;
    const r = lerpRect(R.popped, R.full, q);
    R.card.set(r); R.paper.set(r);
    const c = clamp((q - 0.55) / 0.45);
    for (const el of [...R.content, panelActions, panelBg]) el.style.opacity = c.toFixed(3);
    R.paper.el.style.opacity = '1';
    R.card.el.style.opacity = clamp((0.9 - q) / 0.4).toFixed(3);
    R.face.style.opacity = clamp((0.4 - q) / 0.4).toFixed(3);
  }
  function startDrag() {
    const origin = (detail.origin?.isConnected ? detail.origin : homeEl(detail.id));
    if (!origin || reduced()) return false;
    settle(detail.ctx);
    detail.origin = origin;
    detail.rig = makeRig(origin);
    if (!origin.classList.contains('is-focus')) dim(origin);
    origin.style.transform = `scale(${detail.rig.sc})`;
    dragState(1);
    return true;
  }
  function endDrag(q, close) {
    const R = detail.rig;
    if (!R) return;
    R.origin.style.transform = '';
    if (close) { detail.dragQ = q; closeDetail(); return; }
    const ctx = detail.ctx = newCtx();
    const now = lerpRect(R.popped, R.full, q);
    R.card.animate(ctx, now, R.full, [0, 0.2]); R.paper.animate(ctx, now, R.full, [0, 0.2]);
    for (const el of [...R.content, panelActions, panelBg, R.card.el, R.face]) {
      const to = el === R.card.el || el === R.face ? 0 : 1;
      play(ctx, el, [{ opacity: Number(el.style.opacity || 0) }, { opacity: to }], [0, 0.2], { easing: 'linear' });
    }
    play(ctx, R.origin, [{ transform: `scale(${R.sc})` }, { transform: `scale(${R.sc})` }], [0, 0.2]);
    arm(ctx, () => { R.remove(); if (detail.rig === R) detail.rig = null; for (const el of [...R.content, panelActions, panelBg]) el.style.opacity = ''; });
  }
  let pull = null;
  const touchY = e => e.touches[0]?.clientY ?? 0, touchX = e => e.touches[0]?.clientX ?? 0;
  panel.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || panel.hidden || panel.classList.contains('is-leaving') || e.target.closest('input, textarea')) { pull = null; return; }
    pull = { x: touchX(e), y: touchY(e), top: panelBody.scrollTop <= 0 || !panelBody.contains(e.target), on: false, q: 1, samples: [] };
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (!pull) return;
    const dx = touchX(e) - pull.x, dy = touchY(e) - pull.y;
    if (!pull.on) {
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
    endDrag(p.q, p.dy > panel.getBoundingClientRect().height / 4 || v > 0.5);
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
    closeDetail(true);
  };
  addEventListener('popstate', onPop);

  // ---------- the summary card: a long press (or keyboard focus), as hover is on a desk ----------
  let peekState = null, peekOut = null;
  function heroPeekHTML() {
    const v = view.v, open = v.trays.filter(t => !t.record);
    return `<div class="ix-k">第 ${s.index} 轮 · ${esc(stamp(s.cursor))}</div><div class="ix-q">${v.taps} 下答完 ${v.waiting} 个问题</div>
      <div class="ix-d">${open.length ? `${esc(open.map(t => `${nameOf(t.item.id, t.ask)} ${t.rows}`).join(' + '))} = ${v.taps}` : '此刻没有开着的问题'}</div>
      ${v.answered ? `<div class="ix-d">已答 ${v.answered} 个，回执等下一轮整理</div>` : ''}<div class="ix-d">托盘几排就是几下：确认、批准、选择 1 下，推后、定时刻 2 下。</div>`;
  }
  function itemPeekHTML(id) {
    const v = view.v, tray = v.trays.find(t => t.item.id === id), line = v.ledger.find(l => l.id === id);
    const item = kit.getItem(s.state, id);
    const taps = tray ? (tray.record ? `<div class="ix-d">已答 · ${esc(answerWords(tray.record, tray.ask))} · 等下一轮整理</div>` : `<div class="ix-d is-taps">最少 ${tray.rows} 下：${esc(pathWords(tray.e))}</div>`)
      : line ? `<div class="ix-d">${esc(line.kind === 'mine' ? `已收到 · ${answerWords(line.record, askOfRecord(line.record))}` : line.kind === 'source' ? responseSentence(line.hit.event, line.hit.link) : '随改写失效')}</div>` : '';
    if (item && isRoot(id)) return `${peekHTML(itemFacts(s.index, id))}${taps}`;
    const parent = item?.parent_id && kit.getItem(s.state, item.parent_id);
    return `<div class="ix-k">${esc(parent ? `在「${parent.title}」里` : `第 ${s.index} 轮`)}</div><div class="ix-q">${esc(item?.title || line?.record?.title || id)}</div>${item ? `<div class="ix-d">${item.share} 份 · ${esc(kit.kindLabel[item.kind] || '')}</div>` : ''}${taps}`;
  }
  function showPeek(id, row, via) {
    if (!row || (peekState?.id === id && peekState.row === row)) return;
    hidePeek(true);
    settle(peekOut); peekOut = null;
    peekEl.innerHTML = id === 'hero' ? heroPeekHTML() : itemPeekHTML(id);
    peekEl.dataset.id = id;
    peekEl.hidden = false;
    placePeek(row);
    const w = row.getBoundingClientRect().width, sc = (w + 8) / w;
    const ctx = newCtx();
    peekState = { id, row, via, ctx, sc };
    holdPlay();
    dim(row);
    row.classList.add('is-lifted');
    if (reduced()) return;
    play(ctx, row, popKeys(1, sc), [0, PRESS.peekIn], { easing: 'linear' });
    play(ctx, peekEl, [{ opacity: 0, transform: 'translateY(-4px) scaleY(.94)' }, { opacity: 1, transform: 'none' }], [0, PRESS.peekIn]);
  }
  /** Below the item, or above it when there is no room before the bottom of the screen. */
  function placePeek(row) {
    const scr = screen.getBoundingClientRect(), r = row.getBoundingClientRect();
    peekEl.style.width = `${Math.min(scr.width - 24, 340)}px`;
    const h = peekEl.offsetHeight, w = peekEl.offsetWidth;
    let y = r.bottom + 8;
    if (y + h > scr.bottom - 8) y = r.top - h - 8;
    if (y < scr.top + 4) y = Math.min(r.bottom + 8, scr.bottom - h - 8);
    peekEl.style.left = `${clamp((r.left - scr.left) + (r.width - w) / 2, 8, scr.width - w - 8).toFixed(1)}px`;
    peekEl.style.top = `${(y - scr.top).toFixed(1)}px`;
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
    const ctx = peekOut = newCtx();
    play(ctx, peekEl, [{ opacity: 1 }, { opacity: 0 }], [0, PRESS.peekOut], { easing: 'linear' });
    if (!keepLit) play(ctx, p.row, [{ transform: `scale(${p.sc})` }, { transform: 'none' }], [0.02, PRESS.drop]);
    arm(ctx, () => { if (!peekState) peekEl.hidden = true; });
    releasePlay();
  }

  // ---------- the clock: ← → step (the shell), space plays on; a summary or a detail holds it ----------
  let playing = false, playTimer = null, holding = false, resumeTimer = null, advancing = false;
  function schedule() { clearTimeout(playTimer); playTimer = playing && !holding ? setTimeout(advance, PLAY_MS) : null; }
  function setPlaying(on) { playing = on; schedule(); renderKeys(); }
  function togglePlay() {
    if (playing) { setPlaying(false); return; }
    if (s.index >= last) { advancing = true; model.goFrame(0); advancing = false; }
    setPlaying(true);
  }
  function advance() {
    if (s.index >= last) { setPlaying(false); return; }
    advancing = true; model.goFrame(s.index + 1); advancing = false;
    if (s.index >= last) setPlaying(false); else schedule();
  }
  function holdPlay() { clearTimeout(resumeTimer); holding = true; clearTimeout(playTimer); }
  function releasePlay() {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => { if (!peekState && !detail.id && !disposed) { holding = false; schedule(); } }, IX.resume * 1000);
  }
  function renderKeys() {
    const k = $('.tr-keys-t');
    if (!k) return;
    k.textContent = tour ? (tour.demo ? '讲一遍 · 替你按的几下只是演示，讲完撤回 · 任意键或轻点跳过' : '讲一遍 · 替你按下的是真实数据里的回答 · 任意键或轻点跳过')
      : playing ? '▶ 连播中，每 5.6 秒一轮整理 · 空格暂停 · 长按停住' : '← → 换整理时刻 · 空格 连播 · 轻点按钮作答 · 轻点托盘展开 · 长按看概要';
    const p = $('[data-t="play"]');
    p.textContent = playing ? '❚❚ 暂停' : '▶ 连播';
    p.classList.toggle('is-on', playing);
  }

  // ---------- events ----------
  // Finger guard: for 1.12 s after an answer, the button that slid under your finger does not take the tap.
  const onGuard = event => {
    if (!guard || event.detail === 0) return;
    if (performance.now() > guard.until) { guard = null; return; }
    if (Math.hypot(event.clientX - guard.x, event.clientY - guard.y) > 32) return;
    if (event.target.closest(`[data-key="i:${CSS.escape(guard.id)}"]`)) return; // your own receipt (撤回) is yours
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  screen.addEventListener('click', onGuard, true);
  // A tap while the summary card is up: on the card or its item it opens the detail; anywhere else it folds the card.
  let swallowUntil = 0;
  const onPeekTap = event => {
    if (performance.now() < swallowUntil) { event.stopImmediatePropagation(); event.preventDefault(); return; }
    const p = peekState;
    if (!p || p.via === 'key') return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if ((event.target.closest('.tr-peek') || p.row.contains(event.target)) && p.id !== 'hero') { openDetail(p.id, p.row); return; }
    hidePeek();
  };
  screen.addEventListener('click', onPeekTap, true);
  // A tap outside the phone column (the page around it on a desk) folds a summary or a detail away.
  const outside = event => {
    if (screen.contains(event.target) || event.target.closest?.('.fs-inspector, .fs-bar')) return;
    if (peekState && peekState.via !== 'key') hidePeek();
    else if (detail.id && !event.target.closest('button, a')) closeDetail();
  };
  document.addEventListener('click', outside, true);
  const nudge = id => { const b = homeEl(id)?.querySelector('[data-t-step]'); if (b && !reduced()) b.animate([{ transform: 'none' }, { transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 260, easing: EASE }); };
  screen.addEventListener('click', event => {
    const t = event.target.closest('button, [data-t-pend], .tr-tray, .tr-line, .tr-hero');
    if (!t) return;
    const d = t.dataset;
    if (d.t === 'back') { closeDetail(); return; }
    if (d.t === 'play') { togglePlay(); return; }
    if (d.t === 'replay') { startTour(); return; }
    if (d.tStep) { stepTray(d.tStep, true); return; }
    if (d.tUnstep) { stepTray(d.tUnstep, false); return; }
    if (d.tPend) { nudge(d.tPend); return; }
    if (d.tCustom) {
      const ask = kit.currentAsk(s, d.tCustom);
      if (ask) { if (custom.has(ask.id)) custom.delete(ask.id); else custom.add(ask.id); render('local', { target: d.tCustom }); homeEl(d.tCustom)?.querySelector('[data-t-when]')?.focus({ preventScroll: true }); }
      return;
    }
    if (d.tPick || d.tWhenOk) {
      const id = d.tPick || d.tWhenOk, item = kit.getItem(s.state, id), ask = kit.currentAsk(s, id);
      if (!item || !ask) return;
      let at = Number(d.at);
      if (d.tWhenOk) { const box = t.parentElement.querySelector('[data-t-when]'); at = Date.parse(box?.value || ''); if (!Number.isFinite(at)) { box?.focus(); return; } }
      const e = effortOf(ask);
      if (e.mode === 'defer') give(item, e.action, { until: at });
      else give(item, e.action, { value: `${day(at)} ${clock(at)}` });
      return;
    }
    if (d.tOpen) { openDetail(d.tOpen, homeEl(d.tOpen)); return; }
    if (d.inspect) return; // the shell opens the inspector
    if (t.closest('[data-rs-act],[data-rs-pick],[data-rs-send],[data-rs-undo]')) return;
    if (t.matches('button')) return;
    if (t.matches('.tr-tray, .tr-line') && !event.target.closest('input, a')) openDetail(t.dataset.id, t);
  });
  screen.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('.tr-tray, .tr-line')) {
      event.preventDefault(); event.stopPropagation(); openDetail(event.target.dataset.id, event.target); return;
    }
    if (event.key !== 'Escape') return;
    if (peekState && peekState.via !== 'key') { event.stopPropagation(); hidePeek(); return; }
    if (detail.id) { event.stopPropagation(); closeDetail(); return; }
    const stepped = event.target.closest?.('.tr-tray')?.dataset.id;
    if (stepped && steps.has(kit.currentAsk(s, stepped)?.id)) { event.stopPropagation(); stepTray(stepped, false); return; }
    if (peekState) { event.stopPropagation(); hidePeek(); }
  }, true);
  // Keyboard focus on a tray, a row or the number is its hover: the summary card comes up; Tab on takes it away.
  screen.addEventListener('focusin', event => {
    const row = event.target.matches?.('.tr-tray, .tr-line, .tr-hero') && event.target;
    if (row && !restoring && row.matches(':focus-visible') && scroll.contains(row)) showPeek(row.dataset.id, row, 'key');
  });
  screen.addEventListener('focusout', event => { if (peekState?.via === 'key' && event.target === peekState.row) hidePeek(); });
  const onKey = event => {
    if (event.target.matches?.('input, textarea, select, [contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === ' ' && !event.target.closest?.('button, a, summary, .tr-tray, .tr-line, .tr-hero')) { event.preventDefault(); togglePlay(); }
  };
  document.addEventListener('keydown', onKey);

  // Long press (0.45 s) instead of hover; 0.15 s in, the item darkens a little to say it is waiting.
  const PRESSABLE = '.tr-tray, .tr-line, .tr-hero';
  let press = null, pressHeld = false;
  const cancelPress = () => { if (!press) return; clearTimeout(press.hint); clearTimeout(press.fire); press.el.classList.remove('is-pressing'); press = null; };
  const liftPress = () => { cancelPress(); if (pressHeld) { pressHeld = false; swallowUntil = performance.now() + 150; } };
  screen.addEventListener('pointerdown', event => {
    lastDown = { x: event.clientX, y: event.clientY, t: performance.now() };
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const el = event.target.closest(PRESSABLE);
    if (!el || !scroll.contains(el) || event.target.closest('button, input, textarea, a, select')) return;
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
        showPeek(el.dataset.id, el, 'press');
      }, PRESS.hold * 1000) };
  }, true);
  screen.addEventListener('pointermove', event => { if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS.slop) cancelPress(); });
  screen.addEventListener('pointerup', liftPress);
  screen.addEventListener('pointercancel', liftPress);
  screen.addEventListener('contextmenu', event => { if (event.target.closest(PRESSABLE)) event.preventDefault(); });
  scroll.addEventListener('scroll', () => { cancelPress(); if (peekState) placePeek(peekState.row); }, { passive: true });

  // Swipe a row of 已收到与关上 left past 80 px to say 知道了: it follows the finger and goes on from there when let go.
  let swipe = null;
  function swipeHint(row) {
    const h = document.createElement('span');
    h.className = 'tr-swipe-hint';
    h.setAttribute('aria-hidden', 'true');
    h.textContent = '✓ 知道了';
    h.style.opacity = '0';
    row.append(h);
    return h;
  }
  screen.addEventListener('pointerdown', event => {
    const el = event.target.closest('[data-swipe]');
    if (!el || event.target.closest('button') || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.clientX > innerWidth - 16) return; // from the right edge Safari may go forward: not ours
    swipe = { el, x: event.clientX, y: event.clientY, key: el.dataset.swipe, dx: 0 };
  });
  screen.addEventListener('pointermove', event => {
    if (!swipe) return;
    const dx = Math.min(0, event.clientX - swipe.x);
    if (!swipe.active && Math.abs(event.clientY - swipe.y) > 8) { swipe = null; return; }
    if (!swipe.active && dx < -8) { swipe.active = true; cancelPress(); swipe.el.setPointerCapture?.(event.pointerId); swipe.hint = swipeHint(swipe.el); }
    if (!swipe.active) return;
    swipe.dx = dx;
    swipe.el.style.transform = `translateX(${dx}px)`;
    swipe.hint.style.transform = `translateX(${-dx}px)`;
    swipe.hint.style.opacity = clamp(-dx / 80).toFixed(2);
    swipe.hint.classList.toggle('is-armed', dx < -80);
  });
  const endSwipe = () => {
    if (!swipe) return;
    const { el, dx, key, active, hint } = swipe;
    swipe = null;
    if (!active) return;
    swallowUntil = performance.now() + 150;
    el.style.transform = '';
    hint.remove();
    if (dx < -80) { known.add(key); say('知道了'); render('local', { swipe: { key, dx } }); return; }
    if (reduced()) return;
    el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 200, easing: EASE });
  };
  screen.addEventListener('pointerup', endSwipe);
  screen.addEventListener('pointercancel', endSwipe);

  // ---------- a new 整理时刻 (←/→, the shell's ticks, play, the page above) ----------
  model.subscribe((next, info) => {
    s = next;
    if (info.type === 'init') { render('none'); lastIndex = next.index; return; }
    if (info.type === 'frame' && next.index !== lastIndex) {
      if (!advancing && playing && !tour) setPlaying(false);
      if (tour && !tour.driving) stopTour(false);
      hidePeek(true);
      if (detail.id) closeDetail(true);
      steps.clear(); custom.clear();
      lastIndex = next.index;
      render('turn');
      return;
    }
    render('local');
  });

  // ---------- 讲一遍 ----------
  // Only when this page is the top window, was opened directly (no referrer) and its address had no ?frame= (the shell
  // fills one in before this module runs, so read the address the page was loaded with).
  const TELL = {
    composite: { from: 'f25', at: 'f26', demo: true, end: 'f26', steps: [[0.9, 'go', 'f26'], [2.8, 'press', 'issue-13587', 'approve'], [4.4, 'step', 'pr-reviews-0814'], [5.2, 'pick', 'pr-reviews-0814', 1], [6.8, 'withdraw'], [7.8, 'end']] },
    story: { from: 'f19', at: 'f20', demo: false, end: 'f21', steps: [[0.9, 'go', 'f20'], [2.8, 'press', 'home-photo', 'photo'], [4.4, 'go', 'f21'], [6.4, 'end']] },
  };
  const plan = TELL[new URLSearchParams(location.search).get('data') === 'story' ? 'story' : 'composite'];
  const frameOf = id => s.frames.findIndex(f => f.id === id);
  const topLevel = (() => { try { return window.top === window; } catch { return false; } })();
  const loadedWith = new URL(performance.getEntriesByType?.('navigation')?.[0]?.name || location.href);
  const direct = topLevel && !document.referrer && !loadedWith.searchParams.has('frame');
  function jump(i) { quiet = true; advancing = true; model.goFrame(i); advancing = false; quiet = false; }
  function withdrawTold(animate) {
    const ids = [];
    for (const key of told) { const r = responses.list().find(x => x.key === key); if (r) { responses.removeKey(key); ids.push(r.item); } }
    told = [];
    if (ids.length) { if (animate) render('undo', { targets: ids }); else { quiet = true; render('local'); quiet = false; } }
  }
  function tellStep([, kind, a, b]) {
    if (kind === 'go') { tour.driving = true; advancing = true; model.goFrame(frameOf(a)); advancing = false; tour.driving = false; return; }
    if (kind === 'press') {
      const item = kit.getItem(s.state, a), ask = kit.currentAsk(s, a);
      if (!item || !ask) return;
      const action = normalizeAsk(ask).actions.find(x => x.id === b) || normalizeAsk(ask).actions[0];
      const btn = homeEl(a)?.querySelector(`[data-rs-act="${CSS.escape(`${a}:${action.id}`)}"]`);
      btn?.animate([{ transform: 'none' }, { transform: 'scale(.97)' }, { transform: 'none' }], { duration: 160 });
      const record = give(item, action, action.input?.type === 'photo' ? { value: '1 张照片' } : {}, { tour: true });
      if (record) told.push(record.key);
      return;
    }
    if (kind === 'step') { stepTray(a, true); return; }
    if (kind === 'pick') {
      const ask = kit.currentAsk(s, a), item = kit.getItem(s.state, a);
      if (!ask || !item) return;
      const e = effortOf(ask), choice = (e.mode === 'defer' ? deferChoices(s.cursor) : timeChoices(e.action, s.cursor, dueOf(item, ask)))[b] || null;
      if (!choice) return;
      const record = give(item, e.action, e.mode === 'defer' ? { until: choice.at } : { value: `${day(choice.at)} ${clock(choice.at)}` }, { tour: true });
      if (record) told.push(record.key);
      return;
    }
    if (kind === 'withdraw') { withdrawTold(true); return; }
    if (kind === 'end') stopTour(false);
  }
  function startTour() {
    stopTour(false);
    if (playing) setPlaying(false);
    withdrawTold(false);
    hidePeek(true); if (detail.id) closeDetail(true);
    steps.clear(); custom.clear();
    jump(frameOf(plan.from));
    tour = { demo: plan.demo, driving: false, timers: plan.steps.map(step => setTimeout(() => { if (tour) tellStep(step); }, step[0] * 1000)) };
    renderKeys();
  }
  /** Skipping lands where the telling ends: composite back on f26 with nothing answered for you; story on f21 with the real answer kept. */
  function stopTour(skip) {
    if (!tour) return;
    tour.timers.forEach(clearTimeout);
    tour = null;
    if (skip) {
      settle(beat); beat = null;
      steps.clear(); custom.clear();
      if (plan.demo) withdrawTold(false);
      else {
        const press = plan.steps.find(x => x[1] === 'press');
        if (press && !told.length) {
          const i = frameOf(plan.at), state = s.records[i].state, item = kit.getItem(state, press[2]), ask = kit.currentAsk({ index: i, state }, press[2]);
          const action = ask && (normalizeAsk(ask).actions.find(x => x.id === press[3]) || normalizeAsk(ask).actions[0]);
          if (item && action) told.push(responses.save(item, action, { ask, at: Date.parse(s.frames[i].at), ...(action.input?.type === 'photo' ? { value: '1 张照片' } : {}) }).key);
        }
      }
      if (s.index !== frameOf(plan.end)) jump(frameOf(plan.end)); else { quiet = true; render('local'); quiet = false; }
    }
    renderKeys();
  }
  // Any key skips (and is spent on skipping); so does a press anywhere but on 重演.
  window.addEventListener('keydown', event => { if (!tour) return; event.preventDefault(); event.stopImmediatePropagation(); stopTour(true); }, true);
  // The tap that skips is spent on skipping too: its click does not go on to answer a tray or step the shell.
  let skipTap = 0;
  window.addEventListener('pointerdown', event => { if (tour && !event.target.closest?.('[data-t="replay"]')) { stopTour(true); skipTap = performance.now() + 600; } }, true);
  window.addEventListener('click', event => { if (performance.now() < skipTap) { skipTap = 0; event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  $('[data-t="replay"]').hidden = !topLevel;

  // ---------- hooks for stills and checks (same names and meaning as foldHome) ----------
  const named = name => {
    if (!name) return null;
    if (name === 'hero' || homeEl(name) || kit.getItem(s.state, name)) return name;
    const v = view.v;
    const hit = v.trays.find(t => shortOf(t.item.id) === name || t.item.title === name || shortAsk(t.ask, t.item) === name)
      || v.trays.find(t => t.item.title.includes(name) || t.ask.prompt?.includes(name)) || v.ledger.find(l => shortOf(l.id) === name);
    return hit ? hit.item?.id || hit.id : null;
  };
  const elOf = name => { const id = named(name); return id === 'hero' ? heroEl : homeEl(id); };
  window.foldTrays = {
    model, go: i => model.goFrame(i),
    hover: name => { const id = named(name), el = elOf(name); if (el) showPeek(id, el, 'pointer'); },
    unhover: () => hidePeek(),
    open: name => { const id = named(name); if (id) openDetail(id, homeEl(id)); },
    close: () => closeDetail(),
    /** Hold every running animation at `seconds` from its start (null lets them go on). */
    ixAt: seconds => pin(seconds),
    paused: () => !playing || holding,
    play: () => { if (!playing) togglePlay(); }, stop: () => setPlaying(false), playing: () => playing,
    pointOf: name => { const el = elOf(name); if (!el) return null; const r = (el.querySelector('[data-part="title"], [data-part="receipt"]') || el).getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 120), y: r.top + r.height / 2 }; },
    rowOf: name => { const el = elOf(name); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; },
    /** Answer an item's question: the recommended or first button; a two-step tray takes both taps (the first choice). */
    answer(name, actionId) {
      const id = named(name), ask = id && kit.currentAsk(s, id), item = id && kit.getItem(s.state, id);
      if (!ask || !item) return null;
      const n = normalizeAsk(ask), e = effortOf(ask);
      if (e.kind === 'pick') { const c = (e.mode === 'defer' ? deferChoices(s.cursor) : timeChoices(e.action, s.cursor, dueOf(item, ask)))[0]; give(item, e.action, e.mode === 'defer' ? { until: c.at } : { value: `${day(c.at)} ${clock(c.at)}` }); return e.step; }
      const action = n.actions.find(a => a.id === actionId) || n.actions.find(a => a.recommended) || e.direct?.[0] || e.action || n.actions[0];
      give(item, action, e.kind === 'chips' ? { value: e.chips[0] } : e.kind === 'write' ? { value: '好的' } : action.input?.type === 'photo' ? { value: '1 张照片' } : {});
      return action.label;
    },
    step: name => stepTray(named(name), true),
    unstep: name => stepTray(named(name), false),
    undo: name => undo(named(name)),
    waiting: () => view.v.waiting,
    taps: () => view.v.taps,
    /** Where an item's question shows now and how it looks: tray (rows), stepped, receipt, ledger, prior. */
    facts: name => {
      const id = named(name) || name, el = homeEl(id), v = view.v, tray = v.trays.find(t => t.item.id === id), line = v.ledger.find(l => l.id === id);
      return { id, present: Boolean(el), ask: tray?.ask.id || null, answered: Boolean(tray?.record || line?.kind === 'mine'), rows: tray && !tray.record ? tray.rows : 0, taps: tray?.e.taps ?? null,
        kind: tray?.e.kind || null, height: el ? Math.round(el.getBoundingClientRect().height) : null,
        mark: !el ? null : el.matches('.tr-line') ? 'ledger' : el.matches('.is-receipt') ? 'receipt' : tray?.stepped ? 'stepped' : tray?.prior ? 'prior' : 'tray' };
    },
    trays: () => view.v.trays.map(t => ({ id: t.item.id, short: shortAsk(t.ask, t.item), rows: t.record ? 0 : t.rows, taps: t.e.taps, kind: t.e.kind, answered: Boolean(t.record), height: Math.round(homeEl(t.item.id)?.getBoundingClientRect().height || 0) })),
    ledger: () => view.v.ledger.map(l => ({ id: l.id, kind: l.kind, key: l.kind === 'mine' ? l.record.key : l.key })),
    top: () => view.v.trays.find(t => !t.record && t.e.taps === 1)?.item.id || null,
    two: () => view.v.trays.find(t => !t.record && t.e.taps === 2)?.item.id || null,
    keys: () => [...scroll.querySelectorAll(TOP)].map(x => x.dataset.key),
    tell: () => startTour(), skip: () => stopTour(true), telling: () => Boolean(tour),
    ixState: () => ({
      hover: peekState?.id || null, open: detail.id && !panel.hidden ? detail.id : null, paused: !playing || holding,
      peek: Boolean(peekState) && !peekEl.hidden, inPlace: false,
      detail: !panel.hidden && !panel.classList.contains('is-leaving'),
      clip: panel.hidden ? '' : panel.classList.contains('is-growing') || panel.classList.contains('is-leaving') ? 'growing' : 'none',
      focus: panel.contains(document.activeElement) ? 'detail' : document.activeElement?.matches?.('.tr-tray, .tr-line, .tr-hero') && scroll.contains(document.activeElement) ? 'proxy' : '',
    }),
  };
  if (direct && !reduced()) startTour();
  return () => {
    disposed = true;
    unbindResponses();
    removeEventListener('popstate', onPop);
    document.removeEventListener('click', outside, true);
    document.removeEventListener('keydown', onKey);
    clearTimeout(playTimer); clearTimeout(resumeTimer);
    for (const c of [beat, detail.ctx, peekOut, peekState?.ctx]) settle(c);
    if (window.foldTrays?.model === model) delete window.foldTrays;
  };
}
