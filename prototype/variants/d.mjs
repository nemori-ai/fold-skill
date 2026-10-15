import { escapeHTML as esc, formatDate, formatTime, kindLabel, getItem, colorFor, findEvent, currentAsk, feedbackTrail, scenario, personName, familyMove } from './shared.mjs?v=feedback-loop-1';
import { createResponseStore, responseHTML, composerHTML, keypadHTML, deferHTML, scheduleHTML, bindResponses, setTimeZone, normalizeAsk, responseStatus } from '../respond.mjs?v=respond-1';

// D · 手机首页。人离开半天回来，手机上第一屏回答三件事：几件等我、最急的是哪件、它为什么在这里。
// 首页只放最急的 3 张大卡（档位优先，同档看 due_at，再看份额），其余问题折成一个计数；
// 进行中与结果是纸面上的行；low / trace 的长尾折成一行“另有 N 项次要事项”（与文字简报的尾注同一规则）。
// 本页点按的回应只留在这里演示，不写回状态：先“已保存”，推进到下一轮整理后变为“已收到”。
// 控件、面板与记录来自 ../respond.mjs；D 把它们映射到自己的类名。
// 动画：每次渲染按 data-key 做最小替换，再用 FLIP 让同一事项在位置、尺寸、出现与退场之间连续过渡。
const TOP = 3;
const HOUR = 3600000, DAY = 86400000;
const DUR = 320, EASE = 'cubic-bezier(.2,.75,.25,1)';
const WEIGHT_RANK = { critical: 0, high: 1, normal: 2, low: 3, trace: 4 };
const WEIGHT_WORD = { critical: '档位 关键', high: '档位 高' };
const WEIGHT_NAME = { critical: '关键', high: '高', normal: '常规', low: '低', trace: '微量' };
const EXPECT_WORD = { approve: '批准', choose: '选择', reply: '回复', schedule: '定时间', defer: '推迟', confirm: '确认' };
const meaningLabel = { decide: '需要你决定', input: '需要你提供', act: '需要你去做', know: '只需知道' };
const surfaces = scenario.feedback.surfaces;
setTimeZone(scenario.timeZone || 'Asia/Shanghai');
// respond.mjs part → D's class names.
const RS = { actions: 'd-actions', btn: 'd-btn', fill: 'is-fill', line: 'is-line', write: 'd-write', input: 'd-input', amount: 'd-amount',
  snooze: 'd-snooze', compact: 'd-chip', decide: 'is-decide', receipt: 'd-receipt', check: 'd-check', acked: 'd-acked', undo: 'd-undo',
  keypad: 'd-keypad', 'keypad-value': 'd-keypad-value', 'keypad-chips': 'd-keypad-chips', 'keypad-keys': 'd-keypad-keys',
  'keypad-done': 'd-keypad-done', suggest: 'd-suggest', composer: 'd-composer', send: 'd-send', options: 'd-sheet-options', subject: 'd-subject' };

const dayLong = new Intl.DateTimeFormat('zh-CN', { timeZone: scenario.timeZone || 'Asia/Shanghai', month: 'long', day: 'numeric' });
const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: scenario.timeZone || 'Asia/Shanghai', weekday: 'short' });
const clock = value => formatTime(value);
const stamp = value => `${formatDate(value)} ${clock(value)}`;
function span(ms) {
  const abs = Math.abs(ms);
  return abs < HOUR ? `${Math.max(1, Math.round(abs / 60000))} 分钟` : abs < 2 * DAY ? `${Math.round(abs / HOUR)} 小时` : `${Math.round(abs / DAY)} 天`;
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Run fn once when the animation finishes or is cancelled, or after its duration if no frame comes (a background tab). */
function whenDone(animation, fn, ms) {
  let ran = false;
  const run = () => { if (!ran) { ran = true; fn(); } };
  animation.onfinish = run; animation.oncancel = run;
  setTimeout(run, ms + 120);
  return animation;
}

// ---------- 来源处的动作写成动作句 ----------
// 本人在 GitHub、问答站、论坛等处直接处理（feedback.via = source）时，只写动作与对象，不贴原文；
// 只有指回当前问题（link.ask）的动作才算回应了这张卡，其余明说“这个问题还开着”。
const PLACES = [['GitHub', ' GitHub 上'], ['问答', '问答站'], ['论坛', '论坛'], ['邮件列表', '邮件列表'], ['Mastodon', ' Mastodon 上'], ['博客', '博客'], ['邮件', '邮件里']];
const placeOf = channel => (PLACES.find(([prefix]) => String(channel || '').startsWith(prefix)) || [null, ` ${channel || '原处'}`])[1];
const people = new Set(scenario.frames.flatMap(frame => frame.events.filter(event => !event.self).map(event => event.from)));
function addressee(event) {
  const text = String(event.text || '').trim();
  const mail = text.match(/^On [^\n]{4,40}?, (.+?) (?:via [^\n]+? )?wrote:/);
  if (mail) return mail[1];
  const at = text.match(/^@([^\s,:;]+)(?:\s+([^\s,:;]+))?/);
  if (!at) return null;
  const two = at[2] && `${at[1]} ${at[2]}`;
  const name = two && people.has(two) ? two : at[1];
  return String(event.channel).startsWith('Mastodon') ? `@${name}` : name;
}
function threadRef(event) {
  const m = String(event.subject || '').match(/\((?:PR|Issue) #(\d+)\)/) || String(event.url || '').match(/\/(?:pull|issues)\/(\d+)/);
  return m ? `#${m[1]}` : '';
}
const SOURCE_VERB = { approve: '批准了', 'request-changes': '要求修改了', merge: '合并了', close: '关闭了' };
function actionWords(event, link, ask) {
  if (link.via === 'source' && familyMove(event)) {
    const label = link.meaning === 'decide' && ask?.actions?.find(a => a.id === link.action)?.label;
    return `你${familyMove(event)}${label ? `，选了「${label}」` : ''}`;
  }
  if (link.via === 'source') {
    const ref = threadRef(event);
    let what;
    if (SOURCE_VERB[link.action]) what = `${SOURCE_VERB[link.action]}${ref ? ` ${ref}` : ''}`;
    else if (link.action === 'comment') { const to = addressee(event); what = to ? `回复了 ${to}` : ref ? `评论了 ${ref}` : '发了一条回复'; }
    else { const label = ask?.actions?.find(a => a.id === link.action)?.label; what = label ? `表态「${label}」` : '做了处理'; }
    return `你在${placeOf(event.channel)}${what}`;
  }
  if (link.via === 'button') {
    const label = ask?.actions?.find(a => a.id === link.action)?.label || scenario.feedback?.defaults?.find(d => d.id === link.action)?.label
      || String(event.text || '').match(/「([^」]+)」[。.]?\s*$/)?.[1] || link.action;
    return `你点了「${label}」`;
  }
  const text = String(event.text || '').replace(/\s+/g, ' ');
  return `你回复：“${text.length > 24 ? `${text.slice(0, 23)}…` : text}”`;
}

export function mount(host, model) {
  let s = model.snapshot(), surface = new URLSearchParams(location.search).get('surface') === 'inbox' ? 'inbox' : 'focus';
  let disposed = false, lastIndex = s.index, sheetReturn = null, detailShownId = null, justSnoozed = null;
  const open = { more: false, tail: false };
  const responses = createResponseStore(); // one record per answered item version, this page only
  const drafts = new Map(); // item:action -> amount being edited
  const textDrafts = new Map(); // data-rs-text key -> unsent reply
  const detailStack = [];
  const pulsed = new Set(); // frame:item pairs whose “new question” glow has played

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
        <li><b>键盘</b>← → 换整理时刻 · 空格播放 · Tab 到卡片与按钮 · Enter 看详情 · Esc 返回。</li>
      </ol></section>
      <p class="d-small">在这里点按的回应只留在本页演示，不写回状态：先“已保存”，推进到下一轮整理后变为“已收到”。<button class="d-link" data-d="reset">清除本页回应</button></p>
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
      <div class="d-ghosts" aria-hidden="true"></div>
      <button class="d-fold" data-d="fold" aria-label="查看被折叠的输入与本轮变化"><span class="d-fold-tex" aria-hidden="true"></span><span class="d-fold-text"></span><span class="d-fold-more" aria-hidden="true">›</span></button>
      <section class="d-detail" aria-label="事项详情" hidden></section>
      <div class="d-sheet-backdrop" hidden></div><section class="d-sheet" role="dialog" aria-label="操作" hidden></section>
      <div class="d-toast" role="status" aria-live="polite"></div>
    </div></div></div>
  </div>`;
  const $ = selector => host.querySelector(selector);
  const scroll = $('.d-scroll'), ghosts = $('.d-ghosts');
  const track = $('.d-track');

  // ---------- local feedback records ----------
  const recordOf = item => responses.forItem(item, s.cursor);
  const answeredRecord = item => { const r = recordOf(item); return r && r.meaning !== 'ack' && r.meaning !== 'snooze' ? r : null; };
  /** A local answer to an earlier version of this item (the Agent has rewritten it since). */
  function priorRecord(item) {
    return responses.list(s.cursor).filter(r => r.item === item.id && r.version !== item.updated_at && r.meaning !== 'ack' && r.meaning !== 'snooze')
      .sort((a, b) => b.at - a.at)[0] || null;
  }
  function snoozedItems() {
    const out = [];
    const walk = layer => { for (const item of layer?.items || []) { const f = recordOf(item); if (f?.meaning === 'snooze' && f.until > s.cursor) out.push({ item, f }); walk(item.children); } };
    walk(s.state.root);
    return out;
  }
  function woke(item) { const f = recordOf(item); return f?.meaning === 'snooze' && f.until <= s.cursor ? f : null; }
  const storyReminder = item => s.frame.events.find(event => event.reminder?.target === item.id);
  function give(item, action, value, until) {
    const record = responses.save(item, action, { ask: currentAsk(s, item.id), value, until, at: s.cursor });
    toast(record.meaning === 'ack' || record.meaning === 'snooze' ? answerWords(record) : `已保存 · ${answerWords(record, currentAsk(s, item.id))}`);
    render();
  }
  const ACK = { id: 'ack', label: '已阅', meaning: 'ack' };

  // ---------- what goes where ----------
  const dueOf = (item, ask) => { const v = ask?.due_at || (item.kind !== 'done' ? item.due_at : null); const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
  function dueWords(due) {
    const ms = due - s.cursor;
    if (ms < 0) return { text: `已过 ${span(ms)}`, hot: true, title: `原定 ${stamp(due)} 前` };
    if (ms < 2 * DAY) return { text: `${clock(due)} 前 · 还有 ${span(ms)}`, hot: ms < DAY, title: `${stamp(due)} 前` };
    return { text: `${formatDate(due)} 前`, hot: false, title: `${stamp(due)} 前` };
  }
  /** Most urgent first: the Agent's 档位, then a deadline within a day, then the deadline, share and rank. */
  function urgencyKey(item) {
    const ask = currentAsk(s, item.id), due = dueOf(item, ask);
    const soon = due != null && due - s.cursor < DAY;
    return [WEIGHT_RANK[item.weight] ?? 2, soon ? 0 : 1, due ?? Infinity, -item.share, item.rank];
  }
  const byUrgency = (a, b) => { const x = urgencyKey(a), y = urgencyKey(b); for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };
  function compose() {
    const items = [...(s.state.root.items || [])].sort((a, b) => a.rank - b.rank);
    const snoozed = new Set(snoozedItems().map(x => x.item.id));
    const asks = [], rows = [], tail = [];
    for (const item of items) {
      if (snoozed.has(item.id)) continue;
      const f = recordOf(item);
      if (surface === 'inbox' && f?.meaning === 'ack') continue;
      if (currentAsk(s, item.id)) asks.push(item);
      else if (WEIGHT_RANK[item.weight] >= 3 && !(storyReminder(item) || woke(item))) tail.push(item);
      else rows.push(item);
    }
    asks.sort(byUrgency);
    const zone = [], more = [];
    let big = 0;
    for (const item of asks) {
      const answered = Boolean(answeredRecord(item));
      if (big < TOP) { zone.push({ item, mode: answered ? 'answered' : big === 0 ? 'lead' : 'big' }); if (!answered) big += 1; } else more.push({ item, answered });
    }
    const waiting = asks.filter(item => !answeredRecord(item)).length;
    return { items, asks, zone, more, rows, tail, waiting, answered: asks.length - waiting };
  }

  // ---------- why it is here ----------
  function whyHTML(item, ask) {
    const tags = [];
    if (WEIGHT_WORD[item.weight]) tags.push(`<span class="d-tag is-weight">${WEIGHT_WORD[item.weight]}</span>`);
    const due = dueOf(item, ask);
    if (due != null) { const d = dueWords(due); tags.push(`<span class="d-tag${d.hot ? ' is-hot' : ''}" title="${esc(d.title)}">${esc(d.text)}</span>`); }
    if (ask.frameIndex === s.index) {
      const first = Date.parse(ask.registered_at) === Date.parse(s.frame.at);
      tags.push(`<span class="d-tag is-new">${first ? '新问题' : '问题已更新'}</span>`);
    } else {
      const waited = s.cursor - Date.parse(ask.registered_at);
      if (waited >= 6 * HOUR) tags.push(`<span class="d-tag">已等 ${span(waited)}</span>`);
    }
    tags.push(`<span class="d-tag is-share">${item.share} 份</span>`);
    return tags.join('');
  }
  /** Your latest action on this item since the comparison point, as one sentence. */
  function traceOf(item, ask) {
    const reminder = storyReminder(item), wokeF = woke(item);
    if (reminder) return `◷ 你 ${stamp(reminder.reminder.requested_at)} 让我此时提醒，已按现在的情况重看`;
    if (wokeF) return `◷ 你 ${clock(wokeF.at)} 让我此时提醒 · ${Date.parse(item.updated_at) > wokeF.at ? '期间有更新' : '期间没有新变化'}`;
    const from = s.baseIndex < s.index ? s.baseIndex : s.index - 1;
    const hit = feedbackTrail(s, item.id).filter(t => t.frameIndex > from && t.links.length).at(-1);
    if (!hit) return '';
    const link = hit.links.at(-1);
    const words = actionWords(hit.event, link, ask);
    const relation = !ask ? '' : link.ask && link.ask === ask.id ? '，回应了这个问题' : '；这个问题还开着';
    return `↩ ${clock(hit.event.at)} ${words}${relation}`;
  }

  // ---------- controls ----------
  const snoozeButton = (id, label = '稍后') => `<button type="button" class="rs-snooze d-snooze" data-rs-open="defer" data-rs-key="${esc(id)}" aria-label="稍后提醒">◷<span>${label}</span></button>`;
  /** Primary buttons in a row; a text reply and 稍后 on a quiet second line. reply asks get the composer inline. */
  function answerHTML(item, ask, { inDetail = false, home = false } = {}) {
    const n = normalizeAsk(ask), id = item.id;
    const text = n.actions.filter(a => a.meaning === 'input' && (!a.input?.type || a.input.type === 'text'));
    const primary = n.actions.filter(a => !text.includes(a));
    const subject = n.subject && !home ? `<p class="d-subject">${n.expects === 'approve' ? '批准即：' : ''}${esc(n.subject.label)}</p>` : '';
    if (!primary.length && text.length === 1) {
      const key = `${id}:${text[0].id}`;
      return `<div class="d-answer is-reply">${composerHTML({ ...text[0], input: { placeholder: '回一句，Agent 下一轮整理时带上', ...text[0].input } }, { key, classes: RS })}<div class="d-secondary">${snoozeButton(id)}${inDetail ? '' : `<button type="button" class="d-more-link" data-open="${esc(id)}">详情 ›</button>`}</div></div>`;
    }
    const buttons = responseHTML({ ...n, actions: primary }, { target: id, classes: RS, drafts, snooze: false, showSubject: false });
    const second = [...text.map(a => `<button type="button" class="d-write-link" data-rs-open="compose" data-rs-key="${esc(`${id}:${a.id}`)}">✎ ${esc(a.label)}</button>`),
      n.expects === 'defer' ? '' : snoozeButton(id), inDetail ? '' : `<button type="button" class="d-more-link" data-open="${esc(id)}">详情 ›</button>`].join('');
    return `<div class="d-answer">${buttons}${subject}<div class="d-secondary">${second}</div></div>`;
  }
  /** What you answered, in words that fit the kind of question. */
  function answerWords(record, ask) {
    const n = ask ? normalizeAsk(ask) : null, action = n?.actions.find(a => a.id === record.action);
    if (record.meaning === 'ack') return '已阅';
    if (record.meaning === 'snooze') return `${clock(record.until)} 再提醒`;
    if (record.meaning === 'input') return action?.input?.type === 'datetime' ? `你定了 ${record.value}` : record.value ? `你回复「${record.value}」` : `你提交了「${record.label}」`;
    if (record.meaning === 'act' && (!n || n.expects === 'confirm')) return `你报告「${record.label}」`;
    return `你选了「${record.label}」`;
  }
  /** Receipt in place of the controls: saved (hollow check) until the next 整理 has been replayed, then received (filled). */
  function receiptFor(item, record) {
    const { status, at } = responseStatus(record, s.frames, s.cursor);
    const state = status === 'acknowledged' ? `已收到 · Agent 在 ${clock(at)} 的整理中读到` : '已保存 · 等 Agent 下一轮整理，状态还没变';
    return `<div class="rs-receipt d-receipt is-${status}" data-part="receipt"><span class="rs-check d-check" aria-hidden="true">✓</span><span>${esc(answerWords(record, currentAsk(s, item.id)))} · ${clock(record.at)}<small>${state}</small></span><button type="button" class="rs-undo d-undo" data-rs-undo="${esc(item.id)}">撤回</button></div>`;
  }

  // ---------- home markup; every leaf has a data-key ----------
  const dot = color => `<i class="d-cat" style="--tone:${color}"></i>`;
  function bigCardHTML(item, mode) {
    const ask = currentAsk(s, item.id), headline = ask.prompt || item.title;
    const trace = traceOf(item, ask), prior = priorRecord(item);
    const isNew = ask.frameIndex === s.index && Date.parse(ask.registered_at) === Date.parse(s.frame.at);
    const pulse = isNew && !pulsed.has(`${s.index}:${item.id}`); // a new question glows once when it first appears
    if (pulse) pulsed.add(`${s.index}:${item.id}`);
    const priorLine = prior ? `<p class="d-prior" data-part="prior">你 ${clock(prior.at)} 答过上一版：${esc(prior.label)}${prior.value ? `「${esc(prior.value)}」` : ''} · ${responseStatus(prior, s.frames, s.cursor).status === 'acknowledged' ? 'Agent 已收到，问题随后改写' : '已保存'}<button type="button" class="d-undo" data-undo-key="${esc(prior.key)}">撤回</button></p>` : '';
    return `<article class="d-card is-${mode}${pulse ? ' is-pulse' : ''}" data-key="i:${esc(item.id)}" data-id="${esc(item.id)}" tabindex="0" aria-label="${esc(`${headline}（${item.title}）`)}">
      <div class="d-why" data-part="why">${whyHTML(item, ask)}</div>
      <p class="d-kicker" data-part="title">${dot(colorFor(item, s.state))}<span>${esc(item.title)}</span></p>
      <h3 data-part="prompt">${esc(headline)}</h3>
      ${mode === 'lead' ? `<p class="d-context" data-part="context">${esc(item.summary)}</p>` : ''}
      ${trace ? `<p class="d-trace" data-part="trace">${esc(trace)}</p>` : ''}${priorLine}
      ${answerHTML(item, ask, { home: true })}
    </article>`;
  }
  function answeredHTML(item) {
    const record = answeredRecord(item);
    return `<article class="d-card is-answered" data-key="i:${esc(item.id)}" data-id="${esc(item.id)}" tabindex="0" aria-label="${esc(`已回应：${item.title}`)}">
      <p class="d-kicker" data-part="title">${dot(colorFor(item, s.state))}<span>${esc(item.title)}</span></p>${receiptFor(item, record)}</article>`;
  }
  function askRowHTML({ item, answered }) {
    const ask = currentAsk(s, item.id), due = dueOf(item, ask), d = due != null ? dueWords(due) : null;
    const record = answered ? answeredRecord(item) : null;
    const side = record ? `<span class="d-row-done">✓ ${esc(answerWords(record, ask))}</span>` : chipHTML(item, ask);
    return `<article class="d-ask-row${answered ? ' is-done' : ''}" data-key="i:${esc(item.id)}" data-id="${esc(item.id)}" tabindex="0" aria-label="${esc(ask.prompt || item.title)}">
      <div class="d-ask-row-text"><p class="d-kicker" data-part="title">${dot(colorFor(item, s.state))}<span>${esc(item.title)}</span>${d ? `<em class="${d.hot ? 'is-hot' : ''}">${esc(d.text)}</em>` : ''}</p><h3 data-part="prompt">${esc(ask.prompt || item.title)}</h3></div>${side}</article>`;
  }
  /** The compact control on a folded ask: names the kind of answer; opens the full control in a sheet. */
  function chipHTML(item, ask) {
    const n = normalizeAsk(ask), choices = n.actions.filter(a => a.meaning === 'decide' || a.meaning === 'act');
    const label = n.expects === 'approve' ? '审批' : n.expects === 'reply' ? (n.actions[0].input?.type === 'money' ? '¥ 填写' : n.actions[0].input?.type === 'photo' ? '拍一张' : '回一句')
      : n.expects === 'schedule' ? '选时间' : n.expects === 'defer' ? '推到…' : choices.length > 1 ? `${choices.length} 选 1` : (choices[0]?.label || '回应');
    return `<button type="button" class="rs-compact d-chip${choices.length > 1 ? ' is-decide' : ''}" data-rs-open="actions" data-rs-key="${esc(item.id)}" aria-label="${esc(`${label}：${n.prompt || item.title}`)}">${esc(label)}<span aria-hidden="true">›</span></button>`;
  }
  function moreToggleHTML(more) {
    const waiting = more.filter(x => !x.answered);
    const kinds = {};
    for (const { item } of waiting) { const e = normalizeAsk(currentAsk(s, item.id)).expects; kinds[e] = (kinds[e] || 0) + 1; }
    const mix = Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} 个${EXPECT_WORD[k] || k}`).join(' · ');
    const label = waiting.length ? `还有 ${waiting.length} 件等你回应` : `另 ${more.length} 件已回应`;
    return `<button type="button" class="d-fold-row is-asks${open.more ? ' is-open' : ''}" data-key="more" data-d="more" aria-expanded="${open.more}"><span class="d-fold-row-main" data-part="count"><b>${label}</b><small>${esc(mix || '都在等 Agent 整理')}</small></span><span class="d-chev" aria-hidden="true">⌄</span></button>`;
  }
  const statusWord = item => ({ 'in-progress': '进行中', done: '已完成', fyi: '知会', 'needs-you': '等你' })[item.kind] || '';
  function rowHTML(item) {
    const f = recordOf(item), big = item.share >= 12, trace = traceOf(item, null);
    const due = dueOf(item, null), d = due != null ? dueWords(due) : null;
    const context = big ? `<p class="d-context" data-part="context">${esc(item.summary)}</p>` : '';
    return `<article class="d-line${big ? ' is-big' : ''}${f?.meaning === 'ack' ? ' is-read' : ''}" data-key="i:${esc(item.id)}" data-id="${esc(item.id)}" data-swipe="${esc(item.id)}" tabindex="0">
      <div class="d-line-head"><h3 data-part="title">${esc(item.title)}</h3><span class="d-status" data-part="status">${f?.meaning === 'ack' ? '✓ 已知道' : d ? esc(d.text) : statusWord(item)}</span></div>${context}${trace ? `<p class="d-trace is-quiet" data-part="trace">${esc(trace)}</p>` : ''}</article>`;
  }
  function tailToggleHTML(tail) {
    const used = tail.reduce((n, item) => n + item.share, 0);
    const unread = tail.filter(item => !recordOf(item)).length;
    const byWeight = {};
    for (const item of tail) byWeight[item.weight] = (byWeight[item.weight] || 0) + 1;
    const mix = Object.entries(byWeight).map(([w, n]) => `${WEIGHT_NAME[w] || w}档 ${n}`).join(' · ');
    return `<button type="button" class="d-fold-row is-tail${open.tail ? ' is-open' : ''}" data-key="tail" data-d="tail" aria-expanded="${open.tail}"><span class="d-fold-row-main" data-part="count"><b>另有 ${tail.length} 项次要事项</b><small>${mix} · 共 ${used} 份${unread < tail.length ? ` · ${unread} 项未读` : ''}</small></span><span class="d-chev" aria-hidden="true">⌄</span></button>`;
  }
  function tailItemHTML(item) {
    const f = recordOf(item);
    return `<div class="d-tail-item${f ? ' is-done' : ''}" data-key="i:${esc(item.id)}" data-id="${esc(item.id)}" tabindex="0"><span class="d-tail-title">${esc(item.title)}<small>${statusWord(item)} · ${item.share} 份</small></span>${f ? '<span class="d-tick" aria-label="已知道">✓</span>' : `<button type="button" class="d-quiet" data-ack="${esc(item.id)}">知道了</button>`}</div>`;
  }

  // ---------- keyed patch + FLIP ----------
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
  let running = [];
  const scale = () => { const phone = $('.d-phone'); return phone.offsetWidth ? phone.getBoundingClientRect().width / phone.offsetWidth : 1; };
  /** A fold opened near the bottom: scroll just enough to show its first rows, in the phone (or the page on a real phone), never the host page. */
  function revealOpened(key) {
    const row = scroll.querySelector(`[data-key="${key}"]`);
    if (!row) return;
    const own = getComputedStyle(scroll).overflowY !== 'visible', k = own ? scale() || 1 : 1;
    const box = own ? scroll.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    const fold = $('.d-fold')?.getBoundingClientRect(); // the 累计 bar floats over the bottom
    const bottom = Math.min(box.bottom, fold?.height ? fold.top - 8 * k : box.bottom);
    const r = row.getBoundingClientRect();
    const want = Math.min(r.top + 300 * k - bottom, r.top - box.top - 12 * k); // the fold header plus about three rows
    if (want > 4) (own ? scroll : window).scrollBy({ top: want / k, behavior: reduced() ? 'auto' : 'smooth' });
  }
  function measure() {
    const map = new Map();
    for (const el of scroll.querySelectorAll('[data-key]')) { const r = el.getBoundingClientRect(); map.set(el.dataset.key, { el, top: r.top, left: r.left, width: r.width, height: r.height }); }
    return map;
  }
  const track$ = animation => { running.push(animation); return animation; };
  const radiusOf = el => getComputedStyle(el).borderTopLeftRadius || '0px';
  function ghost(node, rect, k, layer) {
    node.removeAttribute('data-key');
    node.querySelectorAll('[data-key]').forEach(el => el.removeAttribute('data-key'));
    Object.assign(node.style, { position: 'absolute', left: `${(rect.left - layer.left) / k}px`, top: `${(rect.top - layer.top) / k}px`, width: `${rect.width / k}px`, height: `${rect.height / k}px`, margin: '0' });
    node.classList.add('d-ghost');
    node.setAttribute('inert', '');
    ghosts.append(node);
    return node;
  }
  /** Measure → patch → animate from where things were to where they are. Interruptible: in-flight motion is measured, then cancelled.
   *  folded: item id → 'more' | 'tail' for items folded into a count, so they leave into (and come out of) that row. */
  let prevFolded = new Map();
  function update(apply, folded = new Map()) {
    const animate = !reduced() && !document.hidden && scroll.offsetParent !== null;
    const before = animate ? measure() : null;
    for (const a of running) a.cancel();
    running = [];
    const removed = new Map(), replaced = new Map();
    const focus = focusMark();
    apply(removed, replaced);
    restoreFocus(focus);
    restoreDrafts();
    const wasFolded = prevFolded;
    prevFolded = folded;
    if (!animate) { justSnoozed = null; return; }
    const k = scale() || 1, after = measure(), layer = ghosts.getBoundingClientRect();
    let stagger = 0;
    for (const [key, now] of after) {
      const was = before.get(key), el = now.el, r = radiusOf(el);
      if (!was) {
        // Out of a fold row: start at that row and unfold downwards; otherwise reveal in place.
        const from = key.startsWith('i:') && wasFolded.get(key.slice(2));
        const src = from && (before.get(from) || after.get(from));
        const delay = src ? Math.min(stagger++, 8) * 24 : 40;
        const start = src ? `translateY(${(src.top + src.height - now.top) / k - 12}px)` : 'translateY(10px)';
        track$(el.animate([{ opacity: 0, transform: start, clipPath: `inset(0 0 100% 0 round ${r})` }, { opacity: 1, offset: 0.45 }, { opacity: 1, transform: 'none', clipPath: `inset(0 0 0 0 round ${r})` }],
          { duration: DUR + 40, easing: EASE, delay, fill: 'backwards' }));
        continue;
      }
      const dx = (was.left - now.left) / k, dy = (was.top - now.top) / k, h0 = was.height / k, h1 = now.height / k;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) track$(el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: DUR, easing: EASE }));
      const old = replaced.get(key);
      if (old && Math.abs(h0 - h1) > 1) {
        // Morph between two faces of the same item (big card ↔ receipt, row ↔ card): the old face's words leave first,
        // its box follows the new height and dissolves; the new words arrive in the second half. No double text.
        const g = ghost(old, was, k, layer);
        whenDone(track$(g.animate([
          { opacity: 1, transform: 'none', clipPath: `inset(0 0 0 0 round ${r})` },
          { opacity: 1, offset: 0.45 },
          { opacity: 0, transform: `translate(${-dx}px, ${-dy}px)`, clipPath: `inset(0 0 ${Math.max(0, h0 - h1)}px 0 round ${r})` },
        ], { duration: DUR, easing: EASE })), () => g.remove(), DUR);
        for (const child of g.children) track$(child.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR * 0.4, easing: 'linear', fill: 'forwards' }));
        track$(el.animate(h1 > h0
          ? [{ opacity: 0, clipPath: `inset(0 0 ${h1 - h0}px 0 round ${r})` }, { opacity: 0, offset: 0.35 }, { opacity: 1, clipPath: `inset(0 0 0 0 round ${r})` }]
          : [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { duration: DUR, easing: EASE }));
      } else if (old) crossfade(old, el);
    }
    for (const [key, node] of removed) {
      const was = before.get(key);
      if (!was) continue;
      const g = ghost(node, was, k, layer), r = radiusOf(g);
      const into = key.startsWith('i:') && folded.get(key.slice(2));
      const target = into && after.get(into);
      const chip = justSnoozed && key === `i:${justSnoozed}` && $('.d-snoozed:not([hidden])')?.getBoundingClientRect();
      let frames;
      if (chip) frames = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translate(${(chip.left - was.left) / k}px, ${(chip.top - was.top) / k}px) scale(.2)` }];
      else if (target) frames = [{ opacity: 1, transform: 'none' }, { opacity: 0, offset: 0.85 }, { opacity: 0, transform: `translateY(${(target.top - was.top) / k}px) scale(.96, .5)` }];
      else frames = [{ opacity: 1, transform: 'none', clipPath: `inset(0 0 0 0 round ${r})` }, { opacity: 0, transform: 'translateY(-4px) scale(.985)', clipPath: `inset(0 0 100% 0 round ${r})` }];
      g.style.transformOrigin = 'top center';
      whenDone(track$(g.animate(frames, { duration: chip ? DUR + 160 : DUR, easing: EASE })), () => g.remove(), DUR + 160);
    }
    justSnoozed = null;
  }
  /** Same box, new words: only the parts whose text changed fade in, so unchanged words do not blink. */
  function crossfade(old, el) {
    for (const part of el.querySelectorAll('[data-part]')) {
      const before = old.querySelector(`[data-part="${part.dataset.part}"]`);
      if (before && before.textContent === part.textContent) continue;
      track$(part.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE }));
    }
  }
  /** Replace a header line; on a new 整理时刻 it fades in, otherwise only a changed count rolls. */
  function swap(el, html, { fade = false } = {}) {
    if (el.__html === html) return;
    const first = el.__html === undefined;
    const before = el.querySelector('.d-count')?.textContent;
    el.__html = html; el.innerHTML = html;
    if (first || reduced()) return;
    const count = el.querySelector('.d-count');
    if (count && before != null && count.textContent !== before) {
      const down = Number(count.textContent) < Number(before);
      track$(count.animate([{ transform: `translateY(${down ? 0.45 : -0.45}em)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: EASE }));
    } else if (fade) track$(el.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 260, easing: EASE }));
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
    for (const box of scroll.querySelectorAll('[data-rs-text]')) { const v = textDrafts.get(box.dataset.rsText); if (v && !box.value) box.value = v; }
  }

  // ---------- render ----------
  let frameTurned = false; // set by the model subscription: the header fades only on a new 整理时刻
  function render() {
    if (disposed) return;
    const v = compose();
    const folded = new Map([...(open.more ? [] : v.more.map(x => [x.item.id, 'more'])), ...(open.tail ? [] : v.tail.map(item => [item.id, 'tail']))]);
    update((removed, replaced) => {
      const cards = [];
      if (!v.items.length) cards.push({ key: 'empty', html: `<div class="d-empty" data-key="empty"><p>这里还空着</p><span>${s.frame.phase === 'initial' ? '还没有收到第一条需要记住的消息。' : '当前没有占位的事项。'}</span></div>` });
      for (const { item, mode } of v.zone) cards.push({ key: `i:${item.id}`, html: mode === 'answered' ? answeredHTML(item) : bigCardHTML(item, mode) });
      if (v.more.length) {
        cards.push({ key: 'more', html: moreToggleHTML(v.more) });
        if (open.more) for (const entry of v.more) cards.push({ key: `i:${entry.item.id}`, html: askRowHTML(entry) });
      }
      patch($('.d-cards'), cards, removed, replaced);
      const unreadRows = v.rows.filter(item => !recordOf(item));
      const rows = v.rows.length ? [{ key: 'h:rows', html: `<div class="d-zone-head" data-key="h:rows"><span>进行中与结果 · ${v.rows.length}</span>${unreadRows.length > 1 ? `<button type="button" class="d-link is-quiet" data-ack-many="${esc(unreadRows.map(i => i.id).join(','))}">这些都知道了</button>` : ''}</div>` }, ...v.rows.map(item => ({ key: `i:${item.id}`, html: rowHTML(item) }))] : [];
      patch($('.d-rows'), rows, removed, replaced);
      const tail = v.tail.length ? [{ key: 'tail', html: tailToggleHTML(v.tail) }, ...(open.tail ? [...v.tail.map(item => ({ key: `i:${item.id}`, html: tailItemHTML(item) })),
        ...(v.tail.some(item => !recordOf(item)) ? [{ key: 'tail-all', html: `<div class="d-tail-foot" data-key="tail-all"><button type="button" class="d-link is-quiet" data-ack-many="${esc(v.tail.filter(item => !recordOf(item)).map(i => i.id).join(','))}">这些都知道了</button><button type="button" class="d-link is-quiet" data-d="tail">收起</button></div>` }] : [])] : [])] : [];
      patch($('.d-known'), tail, removed, replaced);
      renderHead(v);
    }, folded);
    frameTurned = false;
    renderRail();
    renderDetail();
  }
  function renderHead(v) {
    const at = new Date(s.cursor);
    $('.d-status-time').textContent = clock(at);
    $('.d-date').textContent = `${dayLong.format(at)} ${weekday.format(at)} · ${clock(at)}`;
    const count = n => `<span class="d-count">${n}</span>`;
    swap($('.d-headline'), !v.items.length ? '' : v.waiting ? `${count(v.waiting)} 件等你回应` : v.asks.length ? '都回应了，等 Agent 整理' : '没有要你回应的事');
    const chip = `<button type="button" class="d-surface-chip" data-d="surface" aria-label="屏幕用途：${esc(surfaces.find(x => x.id === surface).label)}，点按切换">${esc(surfaces.find(x => x.id === surface).label)}</button>`;
    const since = sinceHTML(v);
    swap($('.d-since'), since ? `${since} · ${chip}` : '', { fade: frameTurned }); // nothing to sort yet: no surface switch either
    const sz = snoozedItems();
    $('.d-snoozed').hidden = !sz.length;
    $('.d-snoozed').innerHTML = sz.length ? `◷ ${sz.length} 件 · ${clock(Math.min(...sz.map(x => x.f.until)))}` : '';
    $('.d-snoozed').setAttribute('aria-label', sz.length ? `稍后提醒 ${sz.length} 件，最早 ${clock(Math.min(...sz.map(x => x.f.until)))}` : '');
    const signal = s.frame.signal, sig = $('.d-signal');
    sig.hidden = !(signal && signal.type === 'review');
    if (signal?.type === 'review') sig.textContent = `${signal.reason} · ${clock(signal.window.from)} 起收到 0 条 · ${signal.coverage || ''} · ${s.records[s.index].receipt?.type === 'checked' ? '检查后不改' : '按时间重看后有调整'}`;
    const total = s.frames.slice(0, s.index + 1).reduce((n, f) => n + f.events.length, 0);
    const kinds = s.frame.events.reduce((m, e) => (m[e.disposition] = (m[e.disposition] || 0) + 1, m), {});
    const gone = (s.state.historical || []).length, blank = s.state.root.budget - s.state.root.used;
    swap($('.d-fold-text'), `<b>累计 ${total} 条输入 → 现在 ${v.items.length} 件</b><small>本轮 ${s.frame.events.length} 条${kinds.noise ? ` · 噪音 ${kinds.noise}` : ''}${kinds.duplicate ? ` · 重复 ${kinds.duplicate}` : ''}${gone ? ` · 撤下或合并 ${gone}` : ''}${blank > 0 ? ` · 空余 ${blank} 份` : ''}</small>`, { fade: frameTurned });
  }
  function sinceHTML(v) {
    if (s.index === 0 || s.baseIndex >= s.index) return v.items.length ? `${v.answered ? `你已回应 ${v.answered} 件 · ` : ''}这是比较起点` : '';
    const base = s.frames[s.baseIndex], frames = s.frames.slice(s.baseIndex + 1, s.index + 1);
    const received = frames.reduce((n, f) => n + f.events.length, 0);
    const fresh = v.asks.filter(item => Date.parse(currentAsk(s, item.id).registered_at) > Date.parse(base.at)).length;
    const changed = (s.diff.changes || []).filter(c => c.type !== 'annotations_changed').length;
    const mine = new Set(frames.flatMap(f => f.events.filter(e => e.self && e.feedback?.length).flatMap(e => e.feedback.map(l => l.target)))).size;
    const parts = [`收到 ${received} 条`, fresh ? `<b>新问题 ${fresh} 个</b>` : '没有新问题', `${changed} 处变化`];
    if (mine) parts.push(`你在原处处理了 ${mine} 件`);
    if (v.answered) parts.push(`你在这里已回应 ${v.answered} 件`);
    return `上次看是 ${stamp(base.at)}，之后${parts.join('，')}`;
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

  // ---------- detail: why it is here, the evidence, how it changed ----------
  /** The ask registered for this item at or before frame i (any version), for naming the buttons it had. */
  const askAt = (i, id) => { for (let j = i; j >= 0; j -= 1) if (s.frames[j].asks?.[id]) return s.frames[j].asks[id]; return null; };
  function historyOf(item) {
    const steps = [];
    s.records.slice(0, s.index + 1).forEach((record, i) => {
      const frame = s.frames[i];
      const registered = frame.asks?.[item.id];
      for (const event of frame.events) {
        for (const link of (event.feedback || []).filter(l => l.target === item.id)) {
          const words = actionWords(event, link, askAt(i, item.id));
          const last = steps.at(-1);
          if (last?.kind === 'you' && last.text === words) { last.times += 1; last.at = event.at; } else steps.push({ kind: 'you', at: event.at, text: words, times: 1 });
        }
      }
      const change = (record.diff?.changes || []).find(c => c.item === item.id && c.type !== 'annotations_changed');
      if (change) {
        const st = getItem(record.state, item.id);
        const notes = [];
        if (change.type === 'added') notes.push(`纳入 · ${st?.share ?? '?'} 份`);
        else if (change.type !== 'updated') notes.push({ withdrawn: '撤下', merged: '合并', restored: '恢复' }[change.type] || change.type);
        if (change.type === 'updated' && change.fields.includes('share')) notes.push(`${change.before.share} → ${change.after.share} 份`);
        if (change.type === 'updated' && change.fields.includes('kind')) notes.push(`${kindLabel[change.before.kind] || change.before.kind} → ${kindLabel[change.after.kind] || change.after.kind}`);
        if (change.type === 'updated' && !notes.length) notes.push(change.fields.includes('title') ? '改写' : '补充');
        steps.push({ kind: 'change', at: frame.at, text: st?.title || change.after?.title || change.before?.title || item.title, note: notes.join(' · ') });
      }
      if (registered) {
        const first = !steps.some(x => x.kind === 'ask' && x.id === registered.id);
        steps.push({ kind: 'ask', at: frame.at, id: registered.id, text: first ? `登记问题：${registered.prompt}` : '问题随改写重新登记', note: '' });
      }
    });
    return steps;
  }
  const stepHTML = (h, now = false) => `<li class="is-${h.kind}${now ? ' is-now' : ''}"><time>${stamp(h.at)}</time><span>${esc(h.text)}${h.times > 1 ? ` <em>×${h.times}</em>` : ''}</span>${h.note ? `<small>${esc(h.note)}</small>` : ''}</li>`;
  function sourceHTML(src, item) {
    const e = src.ref?.startsWith('event:') ? findEvent(src.ref.slice(6)) : null;
    const author = src.author || e?.from || '';
    const own = e?.self || author === personName || author === scenario.persona?.name;
    const quote = src.quote || (e?.text ? `${e.text.slice(0, 160)}${e.text.length > 160 ? '…' : ''}` : '');
    const pub = e?.publicSourceId && scenario.publicSources?.find(p => p.id === e.publicSourceId);
    return `<article class="d-source"><span class="d-avatar" style="--tone:${own ? '#55565c' : colorFor(item, s.state)}">${esc((own ? '你' : author || '·').replace(/^[^\p{Script=Han}A-Za-z]+/u, '').slice(0, 1) || '·')}</span><div><small>${esc(own ? `你（${author}）` : author)} · ${esc(src.channel || e?.channel || '')}${e ? ` · ${stamp(e.at)}` : ''}</small>${quote ? `<p lang="${/[一-鿿]/.test(quote) ? 'zh' : 'en'}">${esc(quote)}</p>` : ''}${pub ? `<a href="${esc(pub.url)}" target="_blank" rel="noreferrer">${esc(pub.title)} ↗</a>` : ''}</div></article>`;
  }
  function renderDetail() {
    const panel = $('.d-detail');
    const id = s.selectedId, item = id && getItem(s.state, id);
    if (!item) {
      if (!panel.hidden && !panel.classList.contains('is-leaving')) {
        const back = detailShownId;
        detailShownId = null;
        const done = () => { panel.hidden = true; panel.classList.remove('is-leaving'); panel.innerHTML = ''; for (const a of panel.getAnimations()) a.cancel(); };
        if (reduced()) done(); else { panel.classList.add('is-leaving'); whenDone(panel.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(36px)', opacity: 0 }], { duration: 220, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }), done, 220); }
        const card = back && scroll.querySelector(`[data-id="${CSS.escape(back)}"]`);
        card?.focus({ preventScroll: true });
      }
      return;
    }
    const ask = currentAsk(s, item.id), record = recordOf(item), prior = priorRecord(item);
    const history = historyOf(item);
    const anns = (s.state.annotations || []).filter(a => a.item === item.id || item.annotations?.includes(a.id));
    const parent = item.parent_id && getItem(s.state, item.parent_id);
    const due = dueOf(item, ask);
    const facts = [`档位 ${WEIGHT_NAME[item.weight] || item.weight}`, `${item.share} / 64 份`, kindLabel[item.kind]];
    if (due != null) facts.push(dueWords(due).text);
    if (ask) { const waited = s.cursor - Date.parse(ask.registered_at); facts.push(waited < HOUR ? '本轮登记的问题' : `问题已开 ${span(waited)}`); }
    const shownBefore = detailShownId === item.id;
    const scrollTop = shownBefore ? panel.querySelector('.d-detail-body')?.scrollTop || 0 : 0;
    const mine = history.filter(h => h.kind === 'you');
    const visible = history.length > 6 ? history.slice(-5) : history;
    if (panel.classList.contains('is-leaving')) for (const a of panel.getAnimations()) a.cancel(); // reopened mid-exit: finish the exit first
    panel.hidden = false;
    panel.classList.remove('is-leaving');
    panel.innerHTML = `<div class="d-detail-bar"><button data-d="back" aria-label="返回首页">‹</button><span>${esc(parent ? parent.title : '首页')}</span><span class="d-detail-share">${item.share} / 64</span></div>
      <div class="d-detail-body">
        <p class="d-meta">${ask ? `<span class="d-exp">${meaningLabel[normalizeAsk(ask).meanings[0]] || '等你回应'}</span>` : `<span>${kindLabel[item.kind]}</span>`}</p>
        <h2>${esc(ask?.prompt || item.title)}</h2>
        ${ask?.prompt ? `<p class="d-detail-title">${dot(colorFor(item, s.state))}${esc(item.title)}</p>` : ''}
        <section class="d-why-box"><h4>为什么在这里</h4><p class="d-facts">${facts.map(x => `<span>${esc(x)}</span>`).join('')}</p><p>${esc(item.summary)}</p>${item.reason ? `<p class="d-reason">${esc(item.reason)}</p>` : ''}</section>
        ${mine.length ? `<section><h4>你在原处做过的</h4>${mine.slice(-4).reverse().map(h => `<p class="d-loop">↩ <time>${stamp(h.at)}</time> ${esc(h.text)}${h.times > 1 ? ` ×${h.times}` : ''}</p>`).join('')}${ask ? `<p class="d-small">${mine.some(h => h.text) ? '只有指回这个问题的动作才算回答了它；' : ''}这个问题此刻仍开着。</p>` : ''}</section>` : ''}
        ${item.sources?.length ? `<section><h4>依据 · ${item.sources.length} 条</h4>${item.sources.slice(0, 3).map(src => sourceHTML(src, item)).join('')}${item.sources.length > 3 ? `<details class="d-earlier"><summary>其余 ${item.sources.length - 3} 条</summary>${item.sources.slice(3).map(src => sourceHTML(src, item)).join('')}</details>` : ''}</section>` : ''}
        ${history.length ? `<section><h4>这件事怎么变的 · ${history.filter(h => h.kind === 'change').length} 次整理</h4>${history.length > 6 ? `<details class="d-earlier"><summary>更早 ${history.length - 5} 步</summary><ol class="d-timeline">${history.slice(0, -5).map(h => stepHTML(h)).join('')}</ol></details>` : ''}<ol class="d-timeline">${visible.map((h, n) => stepHTML(h, n === visible.length - 1)).join('')}</ol></section>` : ''}
        ${anns.length ? `<section><h4>批注</h4>${anns.map(a => `<p class="d-loop">✎ ${esc(a.text)}<small>批注 · ${a.status === 'acknowledged' ? 'Agent 已纳入整理' : '已保存，等待处理确认'}</small></p>`).join('')}</section>` : ''}
        ${item.children?.items?.length ? `<section><h4>内含 ${item.children.items.length} 件 · 独立 64 份</h4><div class="d-children">${[...item.children.items].sort((a, b) => a.rank - b.rank).map(child => `<button data-open="${esc(child.id)}"><span>${esc(child.title)}</span><small>${currentAsk(s, child.id) ? meaningLabel[normalizeAsk(currentAsk(s, child.id)).meanings[0]] : kindLabel[child.kind]} · ${child.share} 份</small></button>`).join('')}</div></section>` : ''}
        <button class="d-link d-json" data-lab-inspect="state">核对完整状态 JSON ↗</button>
      </div>
      <div class="d-detail-actions">${detailControls(item, ask, record, prior)}</div>`;
    const body = panel.querySelector('.d-detail-body');
    if (shownBefore) body.scrollTop = scrollTop;
    else {
      detailShownId = item.id;
      if (!reduced()) panel.animate([{ transform: 'translateX(36px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: EASE });
      panel.querySelector('[data-d="back"]').focus({ preventScroll: true });
    }
    restoreDrafts();
  }
  function detailControls(item, ask, record, prior) {
    if (record && record.meaning !== 'snooze') return receiptFor(item, record);
    if (ask) return `${prior ? `<p class="d-prior">你 ${clock(prior.at)} 答过上一版：${esc(prior.label)} · 问题随后改写<button type="button" class="d-undo" data-undo-key="${esc(prior.key)}">撤回</button></p>` : ''}${answerHTML(item, ask, { inDetail: true })}`;
    return `<div class="d-actions is-quiet"><button type="button" class="d-btn is-line" data-ack="${esc(item.id)}">${item.kind === 'done' ? '收下' : '知道了'}</button>${snoozeButton(item.id)}</div>`;
  }

  // ---------- sheets ----------
  const sheet = $('.d-sheet'), backdrop = $('.d-sheet-backdrop');
  /** End any open/close motion on the sheet now; a closing sheet hides at once. */
  const settleSheet = () => { for (const el of [sheet, backdrop]) for (const a of el.getAnimations()) a.cancel(); };
  function openSheet(html, label = '操作') {
    settleSheet();
    if (sheet.hidden) sheetReturn = document.activeElement;
    sheet.setAttribute('aria-label', label);
    sheet.innerHTML = `<div class="d-sheet-grip" aria-hidden="true"></div>${html}`;
    const wasHidden = sheet.hidden;
    sheet.hidden = false; backdrop.hidden = false;
    if (wasHidden && !reduced()) {
      sheet.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 300, easing: EASE });
      backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
    }
    restoreDrafts();
    (sheet.querySelector('textarea, [data-rs-keypad], .d-sheet-options button, button:not(.d-sheet-grip)'))?.focus({ preventScroll: true });
  }
  function closeSheet({ refocus = true } = {}) {
    if (sheet.hidden || sheet.classList.contains('is-leaving')) return;
    const done = () => { sheet.classList.remove('is-leaving'); sheet.hidden = true; backdrop.hidden = true; sheet.innerHTML = ''; settleSheet(); };
    if (reduced()) done();
    else {
      sheet.classList.add('is-leaving');
      whenDone(sheet.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: 220, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }), done, 220);
      backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
    }
    if (refocus && sheetReturn?.isConnected) sheetReturn.focus({ preventScroll: true });
    sheetReturn = null;
  }
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

  let toastTimer = null;
  function toast(text) { const t = $('.d-toast'); t.textContent = text; t.classList.add('is-on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), 2200); }

  // ---------- events ----------
  // Answers, panels and undo for registered asks (and 稍后 on any item) go through respond.mjs.
  const unbindResponses = bindResponses(host, {
    drafts,
    ask: id => currentAsk(s, id),
    respond(target, action, { value, until } = {}) {
      closeSheet({ refocus: false });
      const item = findAny(target);
      if (!item) return;
      if (action.meaning === 'snooze') {
        justSnoozed = target;
        if (s.selectedId === target) model.select(null);
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
    undo(target) { closeSheet({ refocus: false }); const item = findAny(target); if (item) { responses.remove(item); toast('已撤回'); render(); } },
  });
  host.addEventListener('input', event => { const box = event.target.closest?.('[data-rs-text]'); if (box) textDrafts.set(box.dataset.rsText, box.value); });
  host.addEventListener('click', event => {
    const t = event.target.closest('button, [data-d], .d-card, .d-ask-row, .d-line, .d-tail-item, .d-sheet-backdrop');
    if (!t) return;
    const d = t.dataset;
    if (t.classList.contains('d-sheet-backdrop')) { closeSheet(); return; }
    if (d.ack) { closeSheet({ refocus: false }); give(findAny(d.ack), ACK); return; }
    if (d.ackMany) { const ids = d.ackMany.split(','); for (const id of ids) responses.save(findAny(id), ACK, { at: s.cursor }); toast(`已阅 ${ids.length} 件 · 每件各记一条`); render(); return; }
    if (d.undoKey) { responses.removeKey(d.undoKey); toast('已撤回'); if (!sheet.hidden && sheet.querySelector('.d-log')) logSheet(); render(); return; }
    if (d.base) { toggleBaseMenu(false); model.setBase(Number(d.base)); return; }
    if (d.open) { closeSheet({ refocus: false }); if (s.selectedId && s.selectedId !== d.open) detailStack.push(s.selectedId); model.select(d.open); return; }
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
    if (t.matches('.d-card, .d-ask-row, .d-line, .d-tail-item') && !event.target.closest('textarea, a')) { detailStack.length = 0; model.select(t.dataset.id); }
  });
  host.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.d-card, .d-ask-row, .d-line, .d-tail-item')) {
      if (event.key === ' ') return; // space stays “play” for the whole page
      event.preventDefault(); detailStack.length = 0; model.select(event.target.dataset.id); return;
    }
    if (event.key !== 'Escape') return;
    if (!sheet.hidden) { event.stopPropagation(); closeSheet(); return; }
    if (!$('.d-base-menu').hidden) { event.stopPropagation(); toggleBaseMenu(false); $('.d-base-btn').focus(); return; }
    if (s.selectedId) { event.stopPropagation(); model.select(detailStack.pop() || null); }
  }, true);
  // Swipe a row left to say “知道了”; a tap opens it.
  let drag = null;
  host.addEventListener('pointerdown', event => { const el = event.target.closest('[data-swipe]'); if (!el || event.target.closest('button') || event.pointerType === 'mouse' && event.button !== 0) return; drag = { el, x: event.clientX, y: event.clientY, id: el.dataset.swipe, dx: 0 }; });
  host.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = Math.min(0, event.clientX - drag.x);
    if (!drag.active && Math.abs(event.clientY - drag.y) > 8) { drag = null; return; }
    if (!drag.active && dx < -8) { drag.active = true; drag.el.setPointerCapture(event.pointerId); }
    if (!drag.active) return;
    drag.dx = dx; drag.el.style.transform = `translateX(${dx}px)`; drag.el.style.opacity = String(1 + dx / 260);
  });
  const endDrag = () => {
    if (!drag) return;
    const { el, dx, id, active } = drag; drag = null;
    if (!active) return;
    const settle = () => { el.style.transform = ''; el.style.opacity = ''; };
    if (dx < -80) { settle(); give(findAny(id), ACK); return; }
    if (reduced()) settle(); else el.animate([{ transform: `translateX(${dx}px)`, opacity: el.style.opacity }, { transform: 'none', opacity: 1 }], { duration: 200, easing: EASE }).onfinish = settle;
    el.addEventListener('click', e => e.stopPropagation(), { capture: true, once: true });
  };
  host.addEventListener('pointerup', endDrag);
  host.addEventListener('pointercancel', endDrag);
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
    if (info.type === 'frame' && next.index !== lastIndex) {
      frameTurned = true;
      closeSheet({ refocus: false });
      if (next.selectedId && !getItem(next.state, next.selectedId)) model.select(null);
    }
    lastIndex = next.index;
    render();
  });
  return () => { disposed = true; unsubscribe(); unbindResponses(); removeEventListener('resize', fit); document.removeEventListener('pointerdown', outside); for (const a of running) a.cancel(); };
}
