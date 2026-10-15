// Shared response controls for registered asks (prototype only).
//
// An ask is a host-side record next to Fold state: which item it asks about, what kind of answer it
// expects, its buttons or input, its own deadline. Shape (prototype/README.md「回应路径」):
//   { id, item, registered_at, due_at, expects, meanings, prompt, actions, subject?, handler }
// `expects` picks the control family; `actions` carry the options or the input field.
//
//   confirm   是 / 否（或一个“我已处理”），旁边总有“稍后”
//   choose    单选几项，可标推荐
//   reply     一句话；input.type 为 money 时是金额，photo 时是拍照
//   schedule  选一个时间：建议时刻或自定义（input.type 为 text 时退回一句话）
//   approve   批准 / 拒绝一个外部动作（合并 PR、发布版本……），subject 写清动作与链接
//   defer     推到某个时刻再提醒
//
// The module gives three layers, so each form can wrap them in its own look:
//   1. data   normalizeAsk, createResponseStore (local demo records: saved → acknowledged; no view tracking)
//   2. markup responseHTML / composerHTML / keypadHTML / deferHTML / scheduleHTML / receiptHTML.
//             Every element has an `rs-*` class; `classes` adds the form's own class names
//             ({ btn: 'd-btn', fill: 'is-fill', … }). Default looks live in respond.css under `.rs-skin`.
//   3. events bindResponses(root, handlers): one delegated listener for clicks and keys.
// mountResponse() combines all three for forms that want a working control in one call.
// Feedback recorded here never writes back to Fold state; it only demonstrates the loop.

export const CONTROLS = {
  confirm: { label: '确认' }, choose: { label: '选择' }, reply: { label: '回复' },
  schedule: { label: '定时间' }, approve: { label: '批准' }, defer: { label: '推迟' },
};
export const meaningWords = { decide: '决定', input: '提供', act: '报告已做', ack: '已阅', snooze: '稍后提醒' };
const DEFAULT_ACTIONS = {
  confirm: [{ id: 'yes', label: '是', meaning: 'decide' }, { id: 'no', label: '否', meaning: 'decide' }],
  choose: [],
  reply: [{ id: 'reply', label: '回一句', meaning: 'input', input: { type: 'text' } }],
  schedule: [{ id: 'time', label: '选时间', meaning: 'input', input: { type: 'datetime' } }],
  approve: [{ id: 'approve', label: '批准', meaning: 'decide' }, { id: 'reject', label: '拒绝', meaning: 'decide' }],
  defer: [{ id: 'defer', label: '推到…', meaning: 'snooze' }],
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HOUR = 3600000;
const zone = 'Asia/Shanghai';
let offsetZone = zone;
let clockFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false });
let dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, month: 'numeric', day: 'numeric', weekday: 'short' });
/** Datasets live in different time zones; forms call this once with scenario.timeZone. */
export function setTimeZone(timeZone) {
  clockFormat = new Intl.DateTimeFormat('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'numeric', day: 'numeric', weekday: 'short' });
  offsetZone = timeZone;
}
export const clock = value => clockFormat.format(new Date(value));
export const day = value => dateFormat.format(new Date(value));

function inferControl(actions) {
  const field = actions.find(action => action.meaning === 'input')?.input;
  if (field) return field.type === 'datetime' ? 'schedule' : 'reply';
  if (actions.length && actions.every(action => action.meaning === 'snooze')) return 'defer';
  return actions.length > 1 && actions.every(action => action.meaning === 'decide') ? 'choose' : 'confirm';
}

/** Fill in the control type, meanings and default options; accepts the older `expects: [...]` form. */
export function normalizeAsk(ask) {
  if (!ask) return null;
  const legacy = Array.isArray(ask.expects) ? ask.expects : null;
  const expects = CONTROLS[ask.expects] ? ask.expects : inferControl(ask.actions || []);
  const actions = ask.actions?.length ? ask.actions : DEFAULT_ACTIONS[expects];
  const meanings = ask.meanings || legacy || [...new Set(actions.map(action => action.meaning).filter(m => m !== 'snooze'))];
  return { ...ask, expects, meanings, actions };
}

// ---------- 1. local demo records ----------

/** One record per answered item version. `at` and `until` are epoch milliseconds. */
export function createResponseStore({ persistKey = null } = {}) {
  const records = new Map();
  const subscribers = new Set();
  const storage = (() => { try { return persistKey ? globalThis.localStorage : null; } catch { return null; } })();
  try { for (const record of JSON.parse(storage?.getItem(persistKey) || '[]')) records.set(record.key, record); } catch { /* start empty */ }
  const changed = () => {
    try { storage?.setItem(persistKey, JSON.stringify([...records.values()])); } catch { /* demo only */ }
    for (const fn of subscribers) fn();
  };
  const keyOf = item => `${item.id}|${item.updated_at}`;
  return {
    keyOf,
    /** The record for this item version, if it was given at or before the cursor. */
    forItem(item, cursor = Infinity) { const record = item && records.get(keyOf(item)); return record && record.at <= cursor ? record : null; },
    save(item, action, { ask = null, value, until, at, via = 'button' } = {}) {
      const record = { key: keyOf(item), item: item.id, version: item.updated_at, title: item.title, ask: ask?.id ?? null,
        action: action.id, label: action.label, meaning: action.meaning, value, until, at, via };
      records.set(record.key, record);
      changed();
      return record;
    },
    remove(item) { records.delete(keyOf(item)); changed(); },
    removeKey(key) { records.delete(key); changed(); },
    clear() { records.clear(); changed(); },
    list(cursor = Infinity) { return [...records.values()].filter(record => record.at <= cursor); },
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
  };
}

/** saved until the next 整理 after the response; acknowledged once a later frame has been replayed. */
export function responseStatus(record, frames, cursor) {
  const next = frames.find(frame => Date.parse(frame.at) > record.at);
  return next && Date.parse(next.at) <= cursor ? { status: 'acknowledged', at: next.at } : { status: 'saved', at: null };
}

/** The record in the same shape as event.feedback, so forms can draw it next to the story's own replies. */
export const asFeedback = record => ({ ask: record.ask, target: record.item, action: record.action, meaning: record.meaning,
  via: record.via, ...(record.value !== undefined ? { value: record.value } : {}), ...(record.until ? { until: record.until } : {}) });

// ---------- 2. markup ----------

const cx = (classes, ...names) => names.filter(Boolean).map(name => `rs-${name}${classes[name] ? ` ${classes[name]}` : ''}`).join(' ');
const money = value => Number(value || 0).toLocaleString('zh-CN');

/** The compact hint used where only a chip fits (“2 选 1”, “¥ 填写”, the single action's label). */
export function compactHint(ask) {
  const first = ask.actions[0];
  if (ask.expects === 'choose' || first.meaning === 'decide') return `${ask.actions.length} 选 1`;
  if (first.meaning === 'input') return first.input?.type === 'photo' ? '📷 拍一张' : first.input?.type === 'money' ? '¥ 填写' : first.input?.type === 'datetime' ? '◷ 选时间' : '填写';
  return first.label;
}

/**
 * The control for one ask. options:
 *   target       item id the answer belongs to (defaults to ask.item)
 *   classes      extra class names per part: actions, btn, fill, line, write, input, amount, snooze, compact, decide, subject
 *   compact      a single chip that opens the full control (data-rs-open="actions")
 *   snooze       append the “稍后” button (default true)
 *   drafts       Map of amounts being edited, keyed "target:action"
 *   showSubject  print approve's subject line (default true)
 */
export function responseHTML(rawAsk, { target, classes = {}, compact = false, snooze = true, drafts = new Map(), showSubject = true } = {}) {
  const ask = normalizeAsk(rawAsk);
  if (!ask) return '';
  const id = target ?? ask.item;
  if (compact) {
    return `<button type="button" class="${cx(classes, 'compact', ask.actions[0]?.meaning === 'decide' && 'decide')}" data-rs-open="actions" data-rs-key="${esc(id)}">${esc(compactHint(ask))}<span aria-hidden="true">›</span></button>`;
  }
  const buttons = ask.actions.map(action => {
    const key = `${id}:${action.id}`;
    if (action.meaning === 'input') {
      const type = action.input?.type;
      if (type === 'photo') return `<button type="button" class="${cx(classes, 'btn', 'line')}" data-rs-act="${esc(key)}">📷 ${esc(action.label)}</button>`;
      if (type === 'money') {
        const value = drafts.get(key) ?? action.input.prefill ?? 0;
        return `<div class="${cx(classes, 'input')}"><button type="button" class="${cx(classes, 'amount')}" data-rs-open="keypad" data-rs-key="${esc(key)}" aria-label="修改${esc(action.label)}"><span>${esc(action.input.unit === '元' || !action.input.unit ? '¥' : action.input.unit)}</span><b>${money(value)}</b><i aria-hidden="true">✎</i></button><button type="button" class="${cx(classes, 'btn', 'fill')}" data-rs-amount="${esc(key)}">${esc(action.input.submit || '确认')}</button></div>`;
      }
      if (type === 'datetime') return `<button type="button" class="${cx(classes, 'btn', 'line', 'write')}" data-rs-open="schedule" data-rs-key="${esc(key)}">◷ ${esc(action.label)}</button>`;
      return `<button type="button" class="${cx(classes, 'btn', 'line', 'write')}" data-rs-open="compose" data-rs-key="${esc(key)}">✎ ${esc(action.label)}</button>`;
    }
    if (action.meaning === 'snooze') return `<button type="button" class="${cx(classes, 'btn', 'line')}" data-rs-open="defer" data-rs-key="${esc(id)}">◷ ${esc(action.label)}</button>`;
    const fill = action.recommended || (ask.actions.length === 1 && action.meaning === 'act');
    return `<button type="button" class="${cx(classes, 'btn', fill ? 'fill' : 'line')}" data-rs-act="${esc(key)}">${esc(action.label)}${action.recommended ? '<small>推荐</small>' : ''}</button>`;
  }).join('');
  const subject = showSubject && ask.subject ? `<p class="${cx(classes, 'subject')}">${ask.expects === 'approve' ? '批准后执行：' : ''}${ask.subject.url ? `<a href="${esc(ask.subject.url)}" target="_blank" rel="noreferrer">${esc(ask.subject.label)} ↗</a>` : esc(ask.subject.label)}</p>` : '';
  const later = snooze && ask.expects !== 'defer' ? `<button type="button" class="${cx(classes, 'snooze')}" data-rs-open="defer" data-rs-key="${esc(id)}" aria-label="稍后提醒">◷<span>稍后</span></button>` : '';
  return `${subject}<div class="${cx(classes, 'actions')}" role="group" aria-label="${esc(ask.prompt || CONTROLS[ask.expects].label)}" data-rs-expects="${ask.expects}">${buttons}${later}</div>`;
}

/** reply: suggestion chips plus a one-line composer. Enter sends, Shift+Enter breaks the line. */
export function composerHTML(action, { key, classes = {} } = {}) {
  const field = action.input || {};
  return `${field.suggestions?.length ? `<div class="${cx(classes, 'suggest')}">${field.suggestions.map(value => `<button type="button" data-rs-pick="${esc(key)}" data-text="${esc(value)}">${esc(value)}</button>`).join('')}</div>` : ''}<div class="${cx(classes, 'composer')}"><textarea rows="2" data-rs-text="${esc(key)}" placeholder="${esc(field.placeholder || '写一句')}" aria-label="${esc(action.label)}"></textarea><button type="button" class="${cx(classes, 'send')}" data-rs-send="${esc(key)}" aria-label="提交">↑</button></div>`;
}

/** reply with input.type money: a keypad. Digit keys, Backspace and Enter work while it has focus. */
export function keypadHTML(action, { key, value, classes = {} } = {}) {
  const shown = value ? money(value) : '0';
  return `<div class="${cx(classes, 'keypad')}" data-rs-keypad="${esc(key)}" tabindex="0" aria-label="${esc(action.label)}：${shown}"><div class="${cx(classes, 'keypad-value')}">¥<b>${shown}</b></div>${action.input.suggestions?.length ? `<div class="${cx(classes, 'keypad-chips')}">${action.input.suggestions.map(v => `<button type="button" data-rs-pad-set="${v}">${money(v)}</button>`).join('')}</div>` : ''}<div class="${cx(classes, 'keypad-keys')}">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'].map(k => `<button type="button" data-rs-pad="${k}"${k === '⌫' ? ' aria-label="删除一位"' : ''}>${k}</button>`).join('')}</div><button type="button" class="${cx(classes, 'btn', 'fill', 'keypad-done')}" data-rs-amount="${esc(key)}">${esc(action.input.submit || '确认')} ¥${shown}</button></div>`;
}

/** Epoch ms of the next 09:00 in the dataset's time zone, strictly after `now`. */
export function nextMorning(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: offsetZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  const localNow = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute);
  const offset = localNow - Math.floor(now / 60000) * 60000;
  let morning = Date.UTC(parts.year, parts.month - 1, parts.day, 9, 0) - offset;
  if (morning <= now) morning += 24 * HOUR;
  return morning;
}

/** defer: preset moments. The answer is a time intent; it is not 已阅 and does not move any due_at. */
export function deferOptions(now) {
  return [['1 小时后', now + HOUR], ['2 小时后', now + 2 * HOUR], ['明早 09:00', nextMorning(now)]];
}
export function deferHTML({ target, now, classes = {} } = {}) {
  return `<div class="${cx(classes, 'options')}" role="group" aria-label="什么时候再提醒">${deferOptions(now).map(([label, at]) => `<button type="button" data-rs-defer="${esc(target)}" data-at="${at}">${label}<small>${day(at)} ${clock(at)}</small></button>`).join('')}</div>`;
}

/** schedule: suggested moments (ISO strings in input.suggestions) or a custom local time. */
export function scheduleHTML(action, { key, now, classes = {} } = {}) {
  const suggestions = (action.input?.suggestions || []).filter(v => Number.isFinite(Date.parse(v)));
  const presets = suggestions.length ? suggestions.map(v => [`${day(v)} ${clock(v)}`, Date.parse(v)]) : deferOptions(now).slice(1).map(([label, at]) => [label, at]);
  return `<div class="${cx(classes, 'options')}" role="group" aria-label="${esc(action.label)}">${presets.map(([label, at]) => `<button type="button" data-rs-schedule="${esc(key)}" data-at="${at}">${esc(label)}<small>${day(at)} ${clock(at)}</small></button>`).join('')}</div><label class="${cx(classes, 'custom')}">自定义<input type="datetime-local" data-rs-when="${esc(key)}"></label><button type="button" class="${cx(classes, 'btn', 'fill')}" data-rs-schedule-custom="${esc(key)}">确认时间</button>`;
}

/** What the person sees after answering: the answer, its time and its status. */
export function receiptHTML(record, { classes = {}, status = 'saved', acknowledgedAt = null, note = '', undo = true } = {}) {
  const back = undo ? `<button type="button" class="${cx(classes, 'undo')}" data-rs-undo="${esc(record.item)}">撤回</button>` : '';
  if (record.meaning === 'ack') return `<div class="${cx(classes, 'acked')}">你已知道 · ${clock(record.at)}${note ? `<small>${esc(note)}</small>` : ''}${back}</div>`;
  const text = record.meaning === 'input' ? `已提交 ${esc(record.value)}` : record.meaning === 'snooze' ? `${clock(record.until)} 再提醒`
    : `你${record.meaning === 'act' ? '报告' : '选了'}「${esc(record.label)}」`;
  const state = status === 'acknowledged' ? `Agent 已在 ${clock(acknowledgedAt)} 的整理中收到` : '等 Agent 下一轮整理；状态尚未改变';
  return `<div class="${cx(classes, 'receipt')}"><span class="${cx(classes, 'check')}">✓</span><span>${text} · ${clock(record.at)}<small>${state}</small></span>${back}</div>`;
}

/** Toast wording for a just-saved answer. */
export function savedText(record) {
  return ({ decide: () => `已选择「${record.label}」`, input: () => `已提交「${record.value ?? record.label}」`, act: () => `已报告「${record.label}」`,
    ack: () => '已阅', snooze: () => `${clock(record.until)} 再提醒` }[record.meaning] || (() => '已记录'))();
}

// ---------- 3. events ----------

/**
 * One delegated listener for every rs control under root. handlers:
 *   ask(target)                         → the current ask for that item (raw or normalized)
 *   respond(target, action, { value, until })   save an answer
 *   open(kind, key)                     show a panel: 'actions' | 'compose' | 'keypad' | 'defer' | 'schedule'
 *   undo(target)
 *   drafts                              Map shared with responseHTML for amounts
 * Returns a function that removes the listeners.
 */
export function bindResponses(root, handlers) {
  const drafts = handlers.drafts || new Map();
  const actionOf = key => { const [target, aid] = key.split(':'); const ask = normalizeAsk(handlers.ask(target)); return { target, ask, action: ask?.actions.find(a => a.id === aid) }; };
  const amountOf = (key, action) => drafts.get(key) ?? action?.input?.prefill ?? 0;
  const pad = (keypad, digit, set) => {
    const key = keypad.dataset.rsKeypad, { action } = actionOf(key);
    const current = String(drafts.get(key) ?? action?.input?.prefill ?? '');
    const next = set ?? (digit === '⌫' ? current.slice(0, -1) : (current === '0' ? '' : current) + digit).slice(0, 9);
    drafts.set(key, next === '' ? 0 : Number(next));
    handlers.open('keypad', key);
  };
  const send = (key, text) => { const { target, action } = actionOf(key); if (action && text) handlers.respond(target, action, { value: text }); };
  function click(event) {
    const t = event.target.closest('[data-rs-act],[data-rs-amount],[data-rs-open],[data-rs-pick],[data-rs-send],[data-rs-defer],[data-rs-schedule],[data-rs-schedule-custom],[data-rs-pad],[data-rs-pad-set],[data-rs-undo]');
    if (!t || !root.contains(t)) return;
    const d = t.dataset;
    event.stopPropagation();
    if (d.rsAct) { const { target, action } = actionOf(d.rsAct); if (action) handlers.respond(target, action, { value: action.input?.type === 'photo' ? '1 张照片' : undefined }); return; }
    if (d.rsAmount) { const { target, action } = actionOf(d.rsAmount); if (action) handlers.respond(target, action, { value: `¥${money(amountOf(d.rsAmount, action))}` }); return; }
    if (d.rsOpen) { handlers.open(d.rsOpen, d.rsKey); return; }
    if (d.rsPick) { send(d.rsPick, d.text); return; }
    if (d.rsSend) { const box = root.querySelector(`[data-rs-text="${CSS.escape(d.rsSend)}"]`); const text = box?.value.trim(); if (!text) { box?.focus(); return; } send(d.rsSend, text); return; }
    if (d.rsDefer) { handlers.respond(d.rsDefer, { id: 'snooze', label: '稍后提醒', meaning: 'snooze' }, { until: Number(d.at) }); return; }
    if (d.rsSchedule) { const { target, action } = actionOf(d.rsSchedule); if (action) handlers.respond(target, action, { value: `${day(Number(d.at))} ${clock(Number(d.at))}` }); return; }
    if (d.rsScheduleCustom) {
      const box = root.querySelector(`[data-rs-when="${CSS.escape(d.rsScheduleCustom)}"]`);
      if (!box?.value) { box?.focus(); return; }
      const { target, action } = actionOf(d.rsScheduleCustom);
      if (action) handlers.respond(target, action, { value: box.value.replace('T', ' ') });
      return;
    }
    if (d.rsPad || d.rsPadSet) { pad(t.closest('[data-rs-keypad]'), d.rsPad, d.rsPadSet); return; }
    if (d.rsUndo) handlers.undo(d.rsUndo);
  }
  function key(event) {
    const box = event.target.closest?.('[data-rs-text]');
    if (box && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); const text = box.value.trim(); if (text) send(box.dataset.rsText, text); return; }
    const keypad = event.target.closest?.('[data-rs-keypad]');
    if (!keypad || event.target.matches('input, textarea')) return;
    if (/^\d$/.test(event.key)) { event.preventDefault(); pad(keypad, event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); pad(keypad, '⌫'); }
    else if (event.key === 'Enter' && event.target === keypad) { event.preventDefault(); keypad.querySelector('[data-rs-amount]')?.click(); }
  }
  root.addEventListener('click', click);
  root.addEventListener('keydown', key);
  return () => { root.removeEventListener('click', click); root.removeEventListener('keydown', key); };
}

/**
 * A working control in one call, with inline panels and default looks (add respond.css).
 *   el       container; gets class rs-skin
 *   ask      the registered ask
 *   item     the item version it answers (id, title, updated_at)
 *   store    createResponseStore()
 *   now      epoch ms of the replay cursor, or a function returning it
 *   frames   scenario.frames, for the saved → acknowledged status
 * Returns { render, destroy }.
 */
export function mountResponse(el, { ask, item, store, now, frames = [], classes = {}, onChange = () => {} }) {
  const drafts = new Map();
  let panel = null;
  const at = () => (typeof now === 'function' ? now() : now);
  el.classList.add('rs-skin');
  const normalized = normalizeAsk(ask);
  const panelHTML = (kind, key) => {
    const action = normalized.actions.find(a => `${item.id}:${a.id}` === key);
    if (kind === 'compose') return composerHTML(action, { key, classes });
    if (kind === 'keypad') return keypadHTML(action, { key, value: drafts.get(key) ?? action.input.prefill, classes });
    if (kind === 'schedule') return scheduleHTML(action, { key, now: at(), classes });
    if (kind === 'defer') return deferHTML({ target: item.id, now: at(), classes });
    return '';
  };
  function render() {
    const record = store.forItem(item, at());
    if (record) {
      const { status, at: acknowledgedAt } = responseStatus(record, frames, at());
      el.innerHTML = receiptHTML(record, { classes, status, acknowledgedAt });
    } else {
      el.innerHTML = `${normalized.prompt ? `<p class="rs-prompt">${esc(normalized.prompt)}</p>` : ''}${responseHTML(normalized, { target: item.id, classes, drafts })}${panel ? `<div class="rs-panel">${panelHTML(panel.kind, panel.key)}</div>` : ''}`;
      if (panel) el.querySelector('.rs-panel textarea, .rs-panel [data-rs-keypad], .rs-panel button')?.focus();
    }
  }
  const unbind = bindResponses(el, {
    drafts,
    ask: () => normalized,
    respond(target, action, extra) { panel = null; store.save(item, action, { ask: normalized, at: at(), ...extra }); render(); onChange(); },
    open(kind, key) { panel = kind === 'actions' ? null : { kind, key }; render(); },
    undo() { store.remove(item); render(); onChange(); },
  });
  const onKey = event => { if (event.key === 'Escape' && panel) { panel = null; render(); } };
  el.addEventListener('keydown', onKey);
  render();
  return { render, destroy() { unbind(); el.removeEventListener('keydown', onKey); el.classList.remove('rs-skin'); el.innerHTML = ''; } };
}
