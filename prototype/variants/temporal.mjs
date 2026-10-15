// B 时间展开与 C 流动形态共用的读法与回应胶水（只服务这两种形式）。
//   · actionSentence  来源处的回应写成动作句（“你在问答站回复了 Gerda”），不贴原文、不冒充回答了别的问题
//   · versionsOf      一件事两周里的版本与每帧份额，供“两周版本”
//   · deadlinesOf     此刻之后的期限：登记的问题自己的 due_at，或条目的 due_at
//   · createResponder respond.mjs 的控件按事项挂进阅读区；本页记录先“已保存”，下一轮整理回放后“已收到”，可撤回
// 本页记录不写回 Fold 状态，只演示回路。
import { escapeHTML as esc, formatDate, formatTime, getItem, currentAsk, records, scenario, personName } from './shared.mjs?v=feedback-loop-1';
import {
  normalizeAsk, responseHTML, composerHTML, keypadHTML, deferHTML, scheduleHTML, bindResponses,
  responseStatus, setTimeZone, deferOptions,
} from '../respond.mjs?v=respond-1';

setTimeZone(scenario.timeZone || 'Asia/Shanghai');
const HOUR = 3600000;
export const stamp = value => `${formatDate(value)} ${formatTime(value)}`;
const frames = scenario.frames;

/** “20 小时后”“3 天后”“已过 1 天 7 小时”. */
export function relative(ms) {
  const past = ms < 0, h = Math.abs(ms) / HOUR;
  const text = h < 1 ? `${Math.max(1, Math.round(h * 60))} 分钟` : h < 48 ? `${Math.round(h)} 小时`
    : `${Math.floor(h / 24)} 天${Math.round(h % 24) ? ` ${Math.round(h % 24)} 小时` : ''}`;
  return past ? `已过 ${text}` : `${text}后`;
}

// ---------- 来源处的回应 ----------
function platformOf(channel = '') {
  if (/^GitHub/.test(channel)) return '在 GitHub 上';
  if (/^问答/.test(channel)) return '在问答站';
  if (/^论坛/.test(channel)) return '在论坛';
  if (/^Mastodon/.test(channel)) return '在 Mastodon 上';
  if (/^邮件列表/.test(channel)) return '在邮件列表';
  if (/^博客/.test(channel)) return '在博客评论区';
  if (/^CI/.test(channel)) return '在 CI 上';
  return channel ? `在${channel}` : '在原处';
}
const objectOf = event => event.subject?.match(/\((?:PR|Issue) (#\d+)\)/)?.[1] || event.url?.match(/\/(?:pull|issues)\/(\d+)/)?.[1]?.replace(/^/, '#') || '';
const addresseeOf = text => String(text || '').match(/^\s*@([^\s,.:;!?@]+)/)?.[1]?.replace(/[-_]$/, '') || '';
const askById = new Map();
frames.forEach((frame, index) => { for (const ask of Object.values(frame.asks || {})) if (!askById.has(ask.id)) askById.set(ask.id, { ...ask, frameIndex: index }); });
const short = (text, n = 22) => { const chars = [...String(text || '')]; return chars.length > n ? `${chars.slice(0, n).join('')}…` : chars.join(''); };

/**
 * One feedback link → a sentence about what the person did, where, and whether it answered the
 * registered question. Only an explicit `link.ask` counts as answering it.
 *   { verb: '你在问答站回复了 Gerda', answered: ask|null, open: ask|null (a question still open that this did not answer) }
 */
export function actionSentence(event, link, frameIndex) {
  const where = platformOf(event.channel), object = objectOf(event), to = addresseeOf(event.text);
  const ask = link.ask ? askById.get(link.ask) : null;
  const chosen = ask?.actions?.find(action => action.id === link.action);
  let verb;
  if (link.meaning === 'snooze') verb = `你要求 ${link.until ? stamp(link.until) : '稍后'} 再提醒`;
  else if (link.meaning === 'ack') verb = '你标为已阅';
  else if (link.via === 'button') verb = `你点了「${chosen?.label || link.action}」`;
  else if (link.via === 'reply') verb = '你回复了 Agent 的消息';
  else if (link.action === 'merge') verb = `你${where}合并了 ${object || '这个 PR'}`;
  else if (link.action === 'close') verb = `你${where}关闭了 ${object || '这一项'}`;
  else if (link.action === 'approve') verb = `你${where}批准了 ${object || '这个 PR'}`;
  else if (link.action === 'request-changes') verb = `你${where}要求修改 ${object}`.trim();
  else if (link.meaning === 'decide') verb = `你${where}${object ? `用 ${object} ` : ''}选了「${chosen?.label || link.action}」`;
  else if (to) verb = `你${where}回复了 ${to}`;
  else if (object) verb = `你${where}评论了 ${object}`;
  else verb = `你${where}留了一条评论`;
  let open = null;
  if (!ask && frameIndex > 0) {
    const before = currentAsk({ index: frameIndex - 1, state: records[frameIndex - 1].state }, link.target);
    const after = currentAsk({ index: frameIndex, state: records[frameIndex].state }, link.target);
    open = after || before || null;
  }
  return { verb, answered: ask, open, original: event.text, url: event.url, at: event.at };
}
/** The relation line under a sentence: what it answered, or that the open question is still open. */
export function relationText(sentence) {
  if (sentence.answered) return `回答了登记的问题「${short(sentence.answered.prompt, 26)}」`;
  if (sentence.open) return `不是在回答「${short(sentence.open.prompt, 20)}」，那个问题仍开着`;
  return '';
}
/** All feedback in one frame, as sentences grouped per target (one line per event). */
export function frameActions(frameIndex) {
  const out = [];
  for (const event of frames[frameIndex]?.events || []) {
    for (const link of event.feedback || []) out.push({ event, link, target: link.target, ...actionSentence(event, link, frameIndex) });
    if (event.reminder) out.push({ event, target: event.reminder.target, reminder: event.reminder, verb: `到点提醒：你 ${stamp(event.reminder.requested_at)} 要求此时再看`, answered: null, open: null, at: event.at });
  }
  return out;
}
/** Every feedback sentence about one item up to a frame, newest first. */
export function itemActions(id, uptoIndex) {
  const out = [];
  for (let index = 0; index <= uptoIndex; index += 1) for (const entry of frameActions(index)) if (entry.target === id) out.push({ ...entry, frameIndex: index });
  return out.reverse();
}
export function actionHTML(entry, { cls = 't', withTarget = null, original = true } = {}) {
  const relation = relationText(entry);
  return `<article class="${cls}-act${entry.answered ? ' is-answer' : ''}"><p class="${cls}-act-verb">${esc(entry.verb)}${withTarget ? ` <button type="button" class="${cls}-act-target" data-t-item="${esc(withTarget.id)}">${esc(short(withTarget.title, 18))} ↗</button>` : ''}</p><p class="${cls}-act-meta"><time>${stamp(entry.at)}</time>${relation ? ` · ${esc(relation)}` : ''}</p>${original && entry.original ? `<details class="${cls}-act-original"><summary>原文</summary><p>${esc(entry.original)}</p>${entry.url ? `<a href="${esc(entry.url)}" target="_blank" rel="noreferrer">在来源处打开 ↗</a>` : ''}</details>` : ''}</article>`;
}

// ---------- 两周版本 ----------
/** Per frame: share of the item (0 when absent); plus one entry per distinct version. */
export function versionsOf(id, uptoIndex = frames.length - 1) {
  const series = [], versions = [];
  for (let index = 0; index < frames.length; index += 1) {
    const item = getItem(records[index].state, id);
    const active = item?.status === 'active';
    const ask = active ? currentAsk({ index, state: records[index].state }, id) : null;
    series.push({ index, share: active ? item.share : 0, ask: Boolean(ask), status: item?.status || null });
    if (index > uptoIndex || !item) continue;
    const last = versions.at(-1);
    if (!last || last.updated_at !== item.updated_at || last.status !== item.status) {
      versions.push({ index, at: frames[index].at, updated_at: item.updated_at, status: item.status, share: item.share, title: item.title, kind: item.kind, summary: item.summary });
    }
  }
  return { series, versions };
}
export function versionsHTML(id, s, { cls = 't', max = 8 } = {}) {
  const { series, versions } = versionsOf(id, s.index);
  const peak = Math.max(12, ...series.map(point => point.share));
  const bars = series.map(point => `<button type="button" class="${cls}-spark-bar${point.index === s.index ? ' is-now' : ''}${point.index > s.index ? ' is-future' : ''}${point.ask ? ' has-ask' : ''}" data-t-frame="${point.index}" style="--v:${(point.share / peak).toFixed(3)}" aria-label="${stamp(frames[point.index].at)}：${point.share ? `${point.share} 份` : '不在状态里'}${point.ask ? '，登记着问题' : ''}" title="${stamp(frames[point.index].at)} · ${point.share ? `${point.share} 份` : '不在'}"></button>`).join('');
  const list = versions.slice(-max).reverse().map(version => `<li${version.index === s.index ? ' class="is-now"' : ''}><button type="button" data-t-frame="${version.index}"><time>${stamp(version.at)}</time><b>${version.status === 'active' ? `${version.share} 份` : version.status === 'merged' ? '已合并' : '已撤下'}</b></button><span>${esc(version.title)}</span></li>`).join('');
  return `<div class="${cls}-spark" role="group" aria-label="两周里每次整理的份额">${bars}</div><p class="${cls}-spark-axis"><span>${formatDate(frames[0].at)}</span><span>${formatDate(frames.at(-1).at)}</span></p><ol class="${cls}-versions">${list}</ol>${versions.length > max ? `<p class="${cls}-muted">另有 ${versions.length - max} 个更早的版本</p>` : ''}`;
}

// ---------- 依据 ----------
const eventById = new Map();
frames.forEach(frame => frame.events.forEach(event => eventById.set(event.id, event)));
export const findEventById = id => eventById.get(id) || null;
export function sourcesHTML(item, { cls = 't' } = {}) {
  if (!item.sources?.length) return '';
  return item.sources.map(source => {
    const event = source.ref?.startsWith('event:') ? eventById.get(source.ref.slice(6)) : null;
    const url = event?.url || (/^https?:\/\//.test(source.ref || '') ? source.ref : '');
    const self = event?.self || [personName, scenario.persona?.name].includes(source.author);
    return `<article class="${cls}-source"><p class="${cls}-source-head"><b>${esc(self ? '你' : source.author || event?.from || '')}</b><span>${esc(source.channel || event?.channel || '')}${event ? ` · ${stamp(event.at)}` : ''}</span></p><p class="${cls}-source-quote">${esc(source.quote || source.content || event?.text || source.ref)}</p>${url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">在来源处打开 ↗</a>` : ''}</article>`;
  }).join('');
}
/** Where the item's inputs came from: channel counts, newest first. */
export function originHTML(item, { cls = 't' } = {}) {
  const channels = new Map();
  for (const source of item.sources || []) {
    const event = source.ref?.startsWith('event:') ? eventById.get(source.ref.slice(6)) : null;
    const key = source.channel || event?.channel || '未注明';
    channels.set(key, (channels.get(key) || 0) + 1);
  }
  if (!channels.size) return '';
  return `<p class="${cls}-origin">${[...channels].map(([name, count]) => `<span>${esc(name)}${count > 1 ? ` ×${count}` : ''}</span>`).join('')}</p>`;
}

// ---------- 期限 ----------
/** Deadlines of the given items at snapshot s: a registered question's due_at, else the item's own due_at. */
export function deadlinesOf(s, items) {
  const out = [];
  for (const item of items) {
    const ask = currentAsk(s, item.id);
    if (ask?.due_at) out.push({ id: item.id, item, at: Date.parse(ask.due_at), kind: 'ask', ask });
    else if (item.due_at) out.push({ id: item.id, item, at: Date.parse(item.due_at), kind: 'item', ask });
  }
  return out.sort((a, b) => a.at - b.at);
}

// ---------- 本页回应记录 ----------
/** The newest local record for an item (any version) given at or before the cursor. */
export function latestRecord(store, id, cursor) {
  return store.list(cursor).filter(record => record.item === id).sort((a, b) => b.at - a.at)[0] || null;
}
/** Wall-clock "YYYY-MM-DDTHH:MM" in the dataset's zone → epoch ms. */
export function zonedEpoch(local, timeZone = scenario.timeZone || 'Asia/Shanghai') {
  const [date, time = '00:00'] = local.split('T');
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess)).map(p => [p.type, p.value]));
  const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute);
  return guess - (shown - guess);
}
const RECORD_WORDS = { decide: record => `你选了「${record.label}」`, act: record => `你报告「${record.label}」`, input: record => record.until ? `你定在 ${stamp(record.until)}` : `你回了「${short(record.value, 24)}」`, snooze: record => `${stamp(record.until)} 再提醒`, ack: () => '你标为已阅' };
export const recordWords = record => (RECORD_WORDS[record.meaning] || (() => '已记录'))(record);

/**
 * Response controls for one form. Each answer is a local record; the form redraws from the store.
 *   cls        class prefix for the form's own parts ('b' → b-rs-*)
 *   snapshot() current model snapshot; onChange(record|null, kind) after save / undo
 */
export function createResponder({ store, snapshot, cls = 't', onChange = () => {}, classes = {} }) {
  const drafts = new Map();
  let panel = null; // { kind, key }
  const cursor = () => snapshot().cursor;
  const nextFrame = at => frames.find(frame => Date.parse(frame.at) > at);
  function panelHTML(ask, item) {
    if (!panel) return '';
    const action = ask?.actions.find(a => `${item.id}:${a.id}` === panel.key);
    if (panel.kind === 'compose' && action) return composerHTML(action, { key: panel.key, classes });
    if (panel.kind === 'keypad' && action) return keypadHTML(action, { key: panel.key, value: drafts.get(panel.key) ?? action.input.prefill, classes });
    if (panel.kind === 'schedule' && action) return scheduleHTML(action, { key: panel.key, now: cursor(), classes });
    if (panel.kind === 'defer') return deferHTML({ target: item.id, now: cursor(), classes });
    return '';
  }
  function receipt(record, ask, item) {
    const { status, at } = responseStatus(record, frames, cursor());
    const next = nextFrame(record.at);
    const state = status === 'acknowledged'
      ? `<span class="${cls}-rs-state is-ack">已收到</span><small>Agent 在 ${stamp(at)} 的整理里收到了这条回应。演示回放不随你的回应改写${ask ? '，所以问题在回放里仍开着' : ''}。</small>`
      : `<span class="${cls}-rs-state">已保存</span><small>${next ? `等下一轮整理（${stamp(next.at)}）由 Agent 确认；` : ''}状态尚未改变。</small>`;
    // A deferral whose moment has passed: say when it came back, and let it be pushed again.
    const back = record.meaning === 'snooze' && record.until <= cursor() ? nextFrame(record.until - 1) : null;
    const again = back ? `<p class="${cls}-rs-back"><span>◷ 已到点，在 ${stamp(back.at)} 这一轮浮回</span><button type="button" data-rs-open="defer" data-rs-key="${esc(record.item)}">再推后…</button></p>${panel?.key?.split(':')[0] === record.item ? `<div class="${cls}-rs-panel">${panelHTML(null, item)}</div>` : ''}` : '';
    return `<div class="${cls}-rs-receipt" data-status="${status}" tabindex="-1"><p><span class="${cls}-rs-check" aria-hidden="true">✓</span><b>${esc(recordWords(record))}</b><time title="记录于 ${stamp(record.at)}">${formatTime(record.at)} 记</time></p><p class="${cls}-rs-status">${state}</p>${again}<button type="button" class="${cls}-rs-undo" data-rs-undo="${esc(record.item)}">撤回</button></div>`;
  }
  return {
    get panel() { return panel; },
    closePanel() { if (!panel) return false; panel = null; return true; },
    /**
     * Prompt, controls or receipt for an item; '' when nothing is registered and nothing was answered.
     *   inlineDefer  a defer question shows its moments at once instead of behind “推到…”
     *   allowDefer   an item without a question still offers the dataset's default “稍后提醒”
     */
    html(item, rawAsk, { inlineDefer = false, allowDefer = false } = {}) {
      const record = latestRecord(store, item.id, cursor());
      const ask = rawAsk ? normalizeAsk(rawAsk) : null;
      if (record) return receipt(record, ask, item);
      const id = esc(item.id), open = panel && panel.key?.split(':')[0] === item.id;
      if (!ask) {
        if (!allowDefer) return '';
        return `<div class="${cls}-rs is-default" data-rs-item="${id}"><p class="${cls}-rs-hint">这一版没有登记问题。可以用默认反馈把它推后，到点再提醒；推后不是已阅，也不改份额。</p><div class="rs-actions"><button type="button" class="rs-btn rs-line" data-rs-open="defer" data-rs-key="${id}">◷ 推后…</button></div>${open ? `<div class="${cls}-rs-panel">${panelHTML(null, item)}</div>` : ''}</div>`;
      }
      const due = ask.due_at ? `<span class="${cls}-rs-due${Date.parse(ask.due_at) < cursor() ? ' is-over' : ''}">${stamp(ask.due_at)} · ${relative(Date.parse(ask.due_at) - cursor())}</span>` : '';
      if (ask.expects === 'defer' && inlineDefer) {
        return `<div class="${cls}-rs is-defer" data-rs-item="${id}"><p class="${cls}-rs-prompt">${esc(ask.prompt)}</p>${due}<div class="${cls}-rs-panel is-inline">${deferHTML({ target: item.id, now: cursor(), classes })}</div></div>`;
      }
      return `<div class="${cls}-rs" data-rs-item="${id}"><p class="${cls}-rs-prompt">${esc(ask.prompt)}</p>${due}${responseHTML(ask, { target: item.id, classes, drafts })}${open ? `<div class="${cls}-rs-panel">${panelHTML(ask, item)}</div>` : ''}</div>`;
    },
    /** Delegated handlers on the reader. getAsk(id) → the raw ask; getItem(id) → the item version. */
    bind(root, { getAsk, getItemVersion, render }) {
      let lastAt = null;
      const capture = event => { const at = event.target.closest?.('[data-at]')?.dataset.at; lastAt = at ? Number(at) : null; };
      root.addEventListener('click', capture, true);
      const unbind = bindResponses(root, {
        drafts,
        ask: id => getAsk(id),
        respond(target, action, extra = {}) {
          const item = getItemVersion(target); if (!item) return;
          let until = extra.until;
          if (action.input?.type === 'datetime') {
            const custom = root.querySelector(`[data-rs-when^="${CSS.escape(target)}:"]`)?.value;
            until = lastAt || (custom ? zonedEpoch(custom) : undefined);
          }
          panel = null;
          const record = store.save(item, action, { ask: getAsk(target) ? normalizeAsk(getAsk(target)) : null, value: extra.value, until, at: cursor(), via: 'button' });
          render(); onChange(record, 'save');
          requestAnimationFrame(() => root.querySelector(`.${cls}-rs-receipt`)?.focus({ preventScroll: true }));
        },
        open(kind, key) {
          panel = kind === 'actions' ? null : { kind, key: kind === 'defer' ? `${key}:defer` : key };
          render();
          requestAnimationFrame(() => root.querySelector(`.${cls}-rs-panel textarea, .${cls}-rs-panel [data-rs-keypad], .${cls}-rs-panel button`)?.focus({ preventScroll: true }));
        },
        undo(target) {
          const record = latestRecord(store, target, cursor());
          if (record) store.removeKey(record.key);
          render(); onChange(record, 'undo');
          requestAnimationFrame(() => root.querySelector(`[data-rs-item="${CSS.escape(target)}"] button`)?.focus({ preventScroll: true }));
        },
      });
      return () => { unbind(); root.removeEventListener('click', capture, true); };
    },
  };
}
export { deferOptions };
