// D 的视图逻辑，D 手机首页与 E 折叠屏共用（variants/d.mjs、variants/duo.mjs）：本页作答记录怎么读、什么算等你回应、
// 最急的三件怎么排（compose / urgencyKey）、卡与行的标记、页头与说明行、详情的内容。只产生 HTML 与数据，不碰 DOM、不管动画。
// 从 d.mjs 原样搬出（2026-10-28），行为不变；createHomeView 拿到同一组本页状态（作答记录、折叠开关、金额草稿、屏幕用途），
// 每次换轮由调用方 sync(s) 交给它最新的回放快照。
import { escapeHTML as esc, formatDate, formatTime, kindLabel, getItem, colorFor, findEvent, currentAsk, feedbackTrail, scenario, personName, familyMove } from './shared.mjs?v=feedback-loop-1';
import { responseHTML, composerHTML, setTimeZone, normalizeAsk, responseStatus } from '../respond.mjs?v=respond-1';
import { detailHTML as ixDetailHTML } from '../forms/motion/ix.mjs';
import { itemFacts, orderOf } from '../forms/motion/dial-model.mjs';

const TOP = 3;
const HOUR = 3600000, DAY = 86400000;
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


export { TOP, HOUR, DAY, WEIGHT_RANK, WEIGHT_WORD, WEIGHT_NAME, EXPECT_WORD, meaningLabel, surfaces, RS, dayLong, weekday, clock, stamp, span, placeOf, addressee, threadRef, actionWords };

/** The view of one page: `s` the replay snapshot (refresh with sync), the page's responses, folds, amount drafts and surface. */
export function createHomeView({ s: first, responses, open, drafts, surfaceOf }) {
  let s = first;
  // ---------- local feedback records ----------
  const isAnswer = r => Boolean(r) && r.meaning !== 'ack' && r.meaning !== 'snooze';
  const recordOf = item => responses.forItem(item, s.cursor); // this version: ack, snooze or answer
  /** This page's answers for an item, newest first, any version. */
  const answersFor = id => responses.list(s.cursor).filter(r => r.item === id && isAnswer(r)).sort((a, b) => b.at - a.at);
  /** The answer to the item's current question. A rewrite that re-registers the same question keeps it: the receipt follows the item. */
  function answeredRecord(item) {
    const ask = currentAsk(s, item.id);
    if (!ask) return null;
    return answersFor(item.id).find(r => (r.ask ? r.ask === ask.id : r.version === item.updated_at)) || null;
  }
  /** The question a record answered, as it was registered (it may have closed since). */
  function askOfRecord(r) {
    if (!r?.ask) return currentAsk(s, r?.item);
    for (let j = s.index; j >= 0; j -= 1) { const a = s.frames[j].asks?.[r.item]; if (a?.id === r.ask) return a; }
    return null;
  }
  /** An answer to an earlier question on this item that the Agent has since replaced with another one. */
  function priorRecord(item) {
    const ask = currentAsk(s, item.id);
    if (!ask) return null;
    return answersFor(item.id).find(r => (r.ask ? r.ask !== ask.id : r.version !== item.updated_at)) || null;
  }
  function snoozedItems() {
    const out = [];
    const walk = layer => { for (const item of layer?.items || []) { const f = recordOf(item); if (f?.meaning === 'snooze' && f.until > s.cursor) out.push({ item, f }); walk(item.children); } };
    walk(s.state.root);
    return out;
  }
  function woke(item) { const f = recordOf(item); return f?.meaning === 'snooze' && f.until <= s.cursor ? f : null; }
  const storyReminder = item => s.frame.events.find(event => event.reminder?.target === item.id);
  /** A question that was open on the last 整理 and closed on this one with no answer pointing at it: it lapsed with a rewrite. */
  function lapsedAsk(item) {
    if (s.index === 0 || currentAsk(s, item.id)) return null;
    const prev = currentAsk({ index: s.index - 1, state: s.previousState }, item.id);
    if (!prev) return null;
    const answered = s.frame.events.some(e => (e.feedback || []).some(l => l.ask === prev.id)) || answersFor(item.id).some(r => r.ask === prev.id);
    return answered ? null : prev;
  }

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
      if (surfaceOf() === 'inbox' && f?.meaning === 'ack') continue;
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
      return `<div class="d-answer is-reply" data-part="answer">${composerHTML({ ...text[0], input: { placeholder: '回一句，Agent 下一轮整理时带上', ...text[0].input } }, { key, classes: RS })}<div class="d-secondary">${snoozeButton(id)}${inDetail ? '' : `<button type="button" class="d-more-link" data-open="${esc(id)}">详情 ›</button>`}</div></div>`;
    }
    const buttons = responseHTML({ ...n, actions: primary }, { target: id, classes: RS, drafts, snooze: false, showSubject: false });
    const second = [...text.map(a => `<button type="button" class="d-write-link" data-rs-open="compose" data-rs-key="${esc(`${id}:${a.id}`)}">✎ ${esc(a.label)}</button>`),
      n.expects === 'defer' ? '' : snoozeButton(id), inDetail ? '' : `<button type="button" class="d-more-link" data-open="${esc(id)}">详情 ›</button>`].join('');
    return `<div class="d-answer" data-part="answer">${buttons}${subject}<div class="d-secondary">${second}</div></div>`;
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
  const receivedWords = (record, at) => `已收到 · Agent 在 ${clock(at)} 的整理中读到`;
  /** Receipt in place of the controls: saved (hollow check) until the next 整理 has been replayed, then received (filled). */
  function receiptFor(item, record) {
    const { status, at } = responseStatus(record, s.frames, s.cursor);
    const state = status === 'acknowledged' ? receivedWords(record, at) : '已保存 · 等 Agent 下一轮整理，状态还没变';
    return `<div class="rs-receipt d-receipt is-${status}" data-part="receipt"><span class="rs-check d-check" aria-hidden="true">✓</span><span>${esc(answerWords(record, askOfRecord(record)))} · ${clock(record.at)}<small>${state}</small></span><button type="button" class="rs-undo d-undo" data-rs-undo="${esc(item.id)}">撤回</button></div>`;
  }

  // ---------- home markup; every leaf has a data-key, every piece of words a data-part ----------
  const dot = color => `<i class="d-cat" style="--tone:${color}"></i>`;
  function bigCardHTML(item, mode) {
    const ask = currentAsk(s, item.id), headline = ask.prompt || item.title;
    const trace = traceOf(item, ask), prior = priorRecord(item);
    const isNew = ask.frameIndex === s.index && Date.parse(ask.registered_at) === Date.parse(s.frame.at);
    const priorLine = prior ? `<p class="d-prior" data-part="prior">你 ${clock(prior.at)} 答过上一版：${esc(prior.label)}${prior.value ? `「${esc(prior.value)}」` : ''} · ${responseStatus(prior, s.frames, s.cursor).status === 'acknowledged' ? 'Agent 已收到，问题随后改写' : '已保存'}<button type="button" class="d-undo" data-undo-key="${esc(prior.key)}">撤回</button></p>` : '';
    return `<article class="d-card is-${mode}"${isNew ? ' data-new=""' : ''} data-key="i:${esc(item.id)}" data-id="${esc(item.id)}" tabindex="0" aria-label="${esc(`${headline}（${item.title}）`)}">
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
    const side = record ? `<span class="d-row-done" data-part="side">✓ ${esc(answerWords(record, ask))}</span>` : chipHTML(item, ask);
    return `<article class="d-ask-row${answered ? ' is-done' : ''}" data-key="i:${esc(item.id)}" data-id="${esc(item.id)}" tabindex="0" aria-label="${esc(ask.prompt || item.title)}">
      <div class="d-ask-row-text"><p class="d-kicker" data-part="title">${dot(colorFor(item, s.state))}<span>${esc(item.title)}</span>${d ? `<em class="${d.hot ? 'is-hot' : ''}">${esc(d.text)}</em>` : ''}</p><h3 data-part="prompt">${esc(ask.prompt || item.title)}</h3></div>${side}</article>`;
  }
  /** The compact control on a folded ask: names the kind of answer; opens the full control in a sheet. */
  function chipHTML(item, ask) {
    const n = normalizeAsk(ask), choices = n.actions.filter(a => a.meaning === 'decide' || a.meaning === 'act');
    const label = n.expects === 'approve' ? '审批' : n.expects === 'reply' ? (n.actions[0].input?.type === 'money' ? '¥ 填写' : n.actions[0].input?.type === 'photo' ? '拍一张' : '回一句')
      : n.expects === 'schedule' ? '选时间' : n.expects === 'defer' ? '推到…' : choices.length > 1 ? `${choices.length} 选 1` : (choices[0]?.label || '回应');
    return `<button type="button" class="rs-compact d-chip${choices.length > 1 ? ' is-decide' : ''}" data-part="side" data-rs-open="actions" data-rs-key="${esc(item.id)}" aria-label="${esc(`${label}：${n.prompt || item.title}`)}">${esc(label)}<span aria-hidden="true">›</span></button>`;
  }
  function moreToggleHTML(more) {
    const waiting = more.filter(x => !x.answered);
    const kinds = {};
    for (const { item } of waiting) { const e = normalizeAsk(currentAsk(s, item.id)).expects; kinds[e] = (kinds[e] || 0) + 1; }
    const mix = Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} 个${EXPECT_WORD[k] || k}`).join(' · ');
    const label = waiting.length ? `还有 ${waiting.length} 件等你回应` : `另 ${more.length} 件已回应`;
    return `<button type="button" class="d-fold-row is-asks${open.more ? ' is-open' : ''}${waiting.length === 1 ? ' is-one' : ''}" data-key="more" data-d="more" aria-expanded="${open.more}"><span class="d-fold-row-main" data-part="count"><b>${label}</b><small>${esc(mix || '都在等 Agent 整理')}</small></span><span class="d-chev" aria-hidden="true">⌄</span></button>`;
  }
  const statusWord = item => ({ 'in-progress': '进行中', done: '已完成', fyi: '知会', 'needs-you': '等你' })[item.kind] || '';
  function rowHTML(item) {
    const f = recordOf(item), big = item.share >= 12, trace = traceOf(item, null);
    const due = dueOf(item, null), d = due != null ? dueWords(due) : null;
    const context = big ? `<p class="d-context" data-part="context">${esc(item.summary)}</p>` : '';
    // The receipt follows the item: once its question has closed, your answer stays under the row.
    const mine = answersFor(item.id)[0];
    const receipt = mine ? `<p class="d-row-receipt" data-part="receipt"><span class="d-check-mini" aria-hidden="true">✓</span>${esc(answerWords(mine, askOfRecord(mine)))} · ${responseStatus(mine, s.frames, s.cursor).status === 'acknowledged' ? '已收到' : '已保存'}</p>` : '';
    const lapse = !mine && lapsedAsk(item) ? '<p class="d-row-lapse" data-part="lapse">这个问题随改写失效</p>' : '';
    return `<article class="d-line${big ? ' is-big' : ''}${f?.meaning === 'ack' ? ' is-read' : ''}" data-key="i:${esc(item.id)}" data-id="${esc(item.id)}" data-swipe="${esc(item.id)}" tabindex="0">
      <div class="d-line-head"><h3 data-part="title">${esc(item.title)}</h3><span class="d-status" data-part="status">${f?.meaning === 'ack' ? '✓ 已知道' : d ? esc(d.text) : statusWord(item)}</span></div>${context}${receipt}${lapse}${trace ? `<p class="d-trace is-quiet" data-part="trace">${esc(trace)}</p>` : ''}</article>`;
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
    return `<div class="d-tail-item${f ? ' is-done' : ''}" data-key="i:${esc(item.id)}" data-id="${esc(item.id)}" tabindex="0"><span class="d-tail-title" data-part="title">${esc(item.title)}<small>${statusWord(item)} · ${item.share} 份</small></span>${f ? '<span class="d-tick" data-part="side" aria-label="已知道">✓</span>' : `<button type="button" class="d-quiet" data-part="side" data-ack="${esc(item.id)}">知道了</button>`}</div>`;
  }

  function buildView(v) {
    const folded = new Map([...(open.more ? [] : v.more.map(x => [x.item.id, 'more'])), ...(open.tail ? [] : v.tail.map(item => [item.id, 'tail']))]);
    const cards = [];
    if (!v.items.length) cards.push({ key: 'empty', html: `<div class="d-empty" data-key="empty"><p>这里还空着</p><span>${s.frame.phase === 'initial' ? '还没有收到第一条需要记住的消息。' : '当前没有占位的事项。'}</span></div>` });
    for (const { item, mode } of v.zone) cards.push({ key: `i:${item.id}`, html: mode === 'answered' ? answeredHTML(item) : bigCardHTML(item, mode) });
    if (v.more.length) {
      cards.push({ key: 'more', html: moreToggleHTML(v.more) });
      if (open.more) for (const entry of v.more) cards.push({ key: `i:${entry.item.id}`, html: askRowHTML(entry) });
    }
    const unreadRows = v.rows.filter(item => !recordOf(item));
    const rows = v.rows.length ? [{ key: 'h:rows', html: `<div class="d-zone-head" data-key="h:rows"><span data-part="count">进行中与结果 · ${v.rows.length}</span>${unreadRows.length > 1 ? `<button type="button" class="d-link is-quiet" data-part="side" data-ack-many="${esc(unreadRows.map(i => i.id).join(','))}">这些都知道了</button>` : ''}</div>` }, ...v.rows.map(item => ({ key: `i:${item.id}`, html: rowHTML(item) }))] : [];
    const tail = v.tail.length ? [{ key: 'tail', html: tailToggleHTML(v.tail) }, ...(open.tail ? [...v.tail.map(item => ({ key: `i:${item.id}`, html: tailItemHTML(item) })),
      ...(v.tail.some(item => !recordOf(item)) ? [{ key: 'tail-all', html: `<div class="d-tail-foot" data-key="tail-all"><button type="button" class="d-link is-quiet" data-ack-many="${esc(v.tail.filter(item => !recordOf(item)).map(i => i.id).join(','))}">这些都知道了</button><button type="button" class="d-link is-quiet" data-d="tail">收起</button></div>` }] : [])] : [])] : [];
    return { v, folded, cards, rows, tail, head: headView(v) };
  }

  /** The head's words: date, headline, since-line, the 累计 bar and its 64-cell band. */
  function headView(v) {
    const at = new Date(s.cursor);
    const count = n => `<span class="d-count">${n}</span>`;
    const headline = !v.items.length ? '' : v.waiting ? `${count(v.waiting)} 件等你回应` : v.asks.length ? '都回应了，等 Agent 整理' : '没有要你回应的事';
    const current = surfaces.find(x => x.id === surfaceOf()).label;
    const chip = `<button type="button" class="d-surface-chip" data-d="surface" aria-label="屏幕用途：${esc(current)}，点按切换">${esc(current)}</button>`;
    const since = sinceHTML(v);
    const sz = snoozedItems();
    const first = sz.length ? clock(Math.min(...sz.map(x => x.f.until))) : '';
    const signal = s.frame.signal;
    const signalText = signal?.type === 'review' ? `${signal.reason} · ${clock(signal.window.from)} 起收到 0 条 · ${signal.coverage || ''} · ${s.records[s.index].receipt?.type === 'checked' ? '检查后不改' : '按时间重看后有调整'}` : '';
    const total = s.frames.slice(0, s.index + 1).reduce((n, f) => n + f.events.length, 0);
    const kinds = s.frame.events.reduce((m, e) => (m[e.disposition] = (m[e.disposition] || 0) + 1, m), {});
    const gone = (s.state.historical || []).length, blank = s.state.root.budget - s.state.root.used;
    const fold = `<b>累计 ${total} 条输入 → 现在 ${v.items.length} 件</b><small>本轮 ${s.frame.events.length} 条${kinds.noise ? ` · 噪音 ${kinds.noise}` : ''}${kinds.duplicate ? ` · 重复 ${kinds.duplicate}` : ''}${gone ? ` · 撤下或合并 ${gone}` : ''}${blank > 0 ? ` · 空余 ${blank} 份` : ''}</small>`;
    // Root shares in first-seen order (the dial's order), so a landing only rescales runs, never reshuffles them.
    let from = 0;
    const segs = [...s.state.root.items].sort((a, b) => orderOf(a.id) - orderOf(b.id)).map(item => { const seg = { id: item.id, from, share: item.share }; from += item.share; return seg; });
    const head = { at, headline, since: since ? `${since} · ${chip}` : '', sz, first, signalText, fold, segs, inputs: s.frame.events.length };
    head.sig = [clock(at), headline, head.since, sz.length, first, signalText, fold, segs.map(x => `${x.id}:${x.from}:${x.share}`).join(',')].join('|');
    return head;
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
  /** The shared detail card's share-by-round bars and this round's inputs (ix.mjs), for an item on the root layer. */
  function ixSections(item) {
    if (!s.state.root.items.some(x => x.id === item.id)) return '';
    const t = document.createElement('template');
    t.innerHTML = ixDetailHTML(itemFacts(s.index, item.id), { last: s.frames.length - 1, href: '', trendH: 28 });
    const keep = [...t.content.querySelectorAll('section')].filter(x => /^(份额|本轮进了它)/.test(x.querySelector('h5')?.textContent || ''));
    return keep.length ? `<div class="d-ixsec">${keep.map(x => x.outerHTML).join('')}</div>` : '';
  }
  function detailParts(item) {
    const ask = currentAsk(s, item.id);
    const history = historyOf(item);
    const anns = (s.state.annotations || []).filter(a => a.item === item.id || item.annotations?.includes(a.id));
    const parent = item.parent_id && getItem(s.state, item.parent_id);
    const due = dueOf(item, ask);
    const facts = [`档位 ${WEIGHT_NAME[item.weight] || item.weight}`, `${item.share} / 64 份`, kindLabel[item.kind]];
    if (due != null) facts.push(dueWords(due).text);
    if (ask) { const waited = s.cursor - Date.parse(ask.registered_at); facts.push(waited < HOUR ? '本轮登记的问题' : `问题已开 ${span(waited)}`); }
    const mine = history.filter(h => h.kind === 'you');
    const visible = history.length > 6 ? history.slice(-5) : history;
    const bar = `<button data-d="back" aria-label="返回首页">‹</button><span>${esc(parent ? parent.title : '首页')}</span><span class="d-detail-share">${item.share} / 64</span>`;
    const body = `<p class="d-meta">${ask ? `<span class="d-exp">${meaningLabel[normalizeAsk(ask).meanings[0]] || '等你回应'}</span>` : `<span>${kindLabel[item.kind]}</span>`}</p>
        <h2>${esc(ask?.prompt || item.title)}</h2>
        ${ask?.prompt ? `<p class="d-detail-title">${dot(colorFor(item, s.state))}${esc(item.title)}</p>` : ''}
        <section class="d-why-box"><h4>为什么在这里</h4><p class="d-facts">${facts.map(x => `<span>${esc(x)}</span>`).join('')}</p><p>${esc(item.summary)}</p>${item.reason ? `<p class="d-reason">${esc(item.reason)}</p>` : ''}</section>
        ${ixSections(item)}
        ${mine.length ? `<section><h4>你在原处做过的</h4>${mine.slice(-4).reverse().map(h => `<p class="d-loop">↩ <time>${stamp(h.at)}</time> ${esc(h.text)}${h.times > 1 ? ` ×${h.times}` : ''}</p>`).join('')}${ask ? `<p class="d-small">${mine.some(h => h.text) ? '只有指回这个问题的动作才算回答了它；' : ''}这个问题此刻仍开着。</p>` : ''}</section>` : ''}
        ${item.sources?.length ? `<section><h4>依据 · ${item.sources.length} 条</h4>${item.sources.slice(0, 3).map(src => sourceHTML(src, item)).join('')}${item.sources.length > 3 ? `<details class="d-earlier"><summary>其余 ${item.sources.length - 3} 条</summary>${item.sources.slice(3).map(src => sourceHTML(src, item)).join('')}</details>` : ''}</section>` : ''}
        ${history.length ? `<section><h4>这件事怎么变的 · ${history.filter(h => h.kind === 'change').length} 次整理</h4>${history.length > 6 ? `<details class="d-earlier"><summary>更早 ${history.length - 5} 步</summary><ol class="d-timeline">${history.slice(0, -5).map(h => stepHTML(h)).join('')}</ol></details>` : ''}<ol class="d-timeline">${visible.map((h, n) => stepHTML(h, n === visible.length - 1)).join('')}</ol></section>` : ''}
        ${anns.length ? `<section><h4>批注</h4>${anns.map(a => `<p class="d-loop">✎ ${esc(a.text)}<small>批注 · ${a.status === 'acknowledged' ? 'Agent 已纳入整理' : '已保存，等待处理确认'}</small></p>`).join('')}</section>` : ''}
        ${item.children?.items?.length ? `<section><h4>内含 ${item.children.items.length} 件 · 独立 64 份</h4><div class="d-children">${[...item.children.items].sort((a, b) => a.rank - b.rank).map(child => `<button data-open="${esc(child.id)}"><span>${esc(child.title)}</span><small>${currentAsk(s, child.id) ? meaningLabel[normalizeAsk(currentAsk(s, child.id)).meanings[0]] : kindLabel[child.kind]} · ${child.share} 份</small></button>`).join('')}</div></section>` : ''}
        <button class="d-link d-json" data-lab-inspect="state">核对完整状态 JSON ↗</button>`;
    return { bar, body, actions: detailControls(item, ask) };
  }
  function detailControls(item, ask) {
    const answered = answeredRecord(item), own = recordOf(item);
    if (answered) return receiptFor(item, answered);
    if (own && own.meaning !== 'snooze') return receiptFor(item, own);
    const prior = priorRecord(item);
    if (ask) return `${prior ? `<p class="d-prior">你 ${clock(prior.at)} 答过上一版：${esc(prior.label)} · 问题随后改写<button type="button" class="d-undo" data-undo-key="${esc(prior.key)}">撤回</button></p>` : ''}${answerHTML(item, ask, { inDetail: true })}`;
    const mine = answersFor(item.id)[0];
    return `${mine ? receiptFor(item, mine) : ''}<div class="d-actions is-quiet"><button type="button" class="d-btn is-line" data-ack="${esc(item.id)}">${item.kind === 'done' ? '收下' : '知道了'}</button>${snoozeButton(item.id)}</div>`;
  }
  return { sync: next => { s = next; }, isAnswer, recordOf, answersFor, answeredRecord, askOfRecord, priorRecord, snoozedItems, woke, storyReminder, lapsedAsk, dueOf, dueWords, urgencyKey, byUrgency, compose, whyHTML, traceOf, snoozeButton, answerHTML, answerWords, receivedWords, receiptFor, dot, bigCardHTML, answeredHTML, askRowHTML, chipHTML, moreToggleHTML, statusWord, rowHTML, tailToggleHTML, tailItemHTML, buildView, headView, sinceHTML, askAt, historyOf, stepHTML, sourceHTML, ixSections, detailParts, detailControls };
}
