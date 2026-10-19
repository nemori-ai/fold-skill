// Helpers shared by the two spatial forms: the original treemap (app.mjs) and A (variants/a.mjs).
// Nothing here writes Fold state. It reads the replay from shared.mjs and gives both forms:
//   1. wording   how an input reads (action sentences for the person's own moves, markdown kept readable)
//   2. folding   the root layer's long tail of one-share items as one block, and the urgent asks first
//   3. history   the versions of one item across the replay
//   4. answers   a page-local answer book over respond.mjs (saved → acknowledged after the next 整理)
//   5. motion    a keyed board whose tiles keep their DOM node across frames and move with FLIP
import { scenario, records, getItem, currentAsk, personName, formatDate, formatTime, escapeHTML as esc, familyMove } from './shared.mjs?v=feedback-loop-1';
import { normalizeAsk, createResponseStore, responseStatus, setTimeZone } from '../respond.mjs?v=respond-1';

setTimeZone(scenario.timeZone || 'Asia/Shanghai');
export const TAIL_ID = '__tail__';
export const streamNames = { work: '工作', family: '家庭', community: '社区', life: '生活', subscription: '订阅' };
const stamp = value => `${formatDate(value)} ${formatTime(value)}`;
const HOUR = 3600000;

// ---------- 1. wording ----------

/** Markdown kept readable without a parser: headings, lists, quotes, fences, inline code, bold, links. */
export function markdownHTML(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [], list = null, quote = [], fence = null;
  const inline = source => {
    const codes = [];
    let html = esc(source).replace(/`([^`\n]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`);
    html = html.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/(?<![="'>])(https?:\/\/[^\s<]+[^\s<.,;:)!?])/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    return html.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
  };
  const flushParagraph = () => { if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map(item => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`); list = null; };
  const flushQuote = () => { if (quote.length) out.push(`<blockquote>${quote.map(line => inline(line)).join('<br>')}</blockquote>`); quote = []; };
  const flush = () => { flushParagraph(); flushList(); flushQuote(); };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (fence) {
      if (/^\s*(```|~~~)/.test(line)) { out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`); fence = null; } else fence.push(raw);
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) { flush(); fence = []; continue; }
    if (!line.trim()) { flush(); continue; }
    let match;
    if ((match = line.match(/^\s{0,3}#{1,6}\s+(.*)$/))) { flush(); out.push(`<p class="md-h">${inline(match[1])}</p>`); continue; }
    if ((match = line.match(/^\s*>\s?(.*)$/))) { flushParagraph(); flushList(); quote.push(match[1]); continue; }
    if ((match = line.match(/^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/))) {
      flushParagraph(); flushQuote();
      const tag = match[1] ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(match[2]); continue;
    }
    if (/^[\w./-]+\.[\w]+:\d+$/.test(line.trim()) && !paragraph.length) { flush(); out.push(`<p class="md-file"><code>${esc(line.trim())}</code></p>`); continue; }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    flushList(); flushQuote(); paragraph.push(line.trim());
  }
  if (fence) out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`);
  flush();
  return out.join('');
}

/** One line of plain text: markdown marks removed, quoted lines dropped when the author also wrote their own. */
export function plainText(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
    .filter(line => !/^\s*(```|~~~)/.test(line) && !/^On .{6,80} wrote:\s*$/.test(line.trim()));
  const own = lines.filter(line => !/^\s*>/.test(line) && line.trim());
  return (own.length ? own : lines).join(' ')
    .replace(/^\s*#{1,6}\s+/gm, '').replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/(^|\s)>\s?/g, '$1').replace(/(^|\s)(?:[-*+]|\d+[.)])\s+/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

/** Where an input came from, read off its channel, id and subject line. */
export function eventRef(event) {
  const channel = event.channel || '';
  const subject = String(event.subject || '').replace(/^(?:Re:\s*)+/i, '').replace(/^New comment:\s*/i, '').trim();
  const kind = String(event.id || '').split(':')[0];
  if (/^(GitHub|CI)/.test(channel)) {
    const match = subject.match(/^\[([^\]]+)\]\s*(.*?)\s*\((PR|Issue|Discussion) #(\d+)\)\s*$/);
    const repo = match?.[1] || channel.split('·')[1]?.trim() || '';
    return { platform: channel.startsWith('CI') ? 'CI' : 'GitHub', kind, repo, title: match?.[2] || subject,
      type: { PR: 'pr', Issue: 'issue', Discussion: 'discussion' }[match?.[3]] || null, number: match?.[4] || null,
      label: match ? `#${match[4]}${repo && repo !== 'skarv/skarv' ? `（${repo.split('/').at(-1)}）` : ''}` : '' };
  }
  const site = channel.split('·')[1]?.trim() || '';
  if (channel.startsWith('问答')) {
    const type = kind === 'qa' ? ({ q: 'question', a: 'answer', c: 'comment' }[String(event.id).split(':')[2]?.[0]] || 'comment') : 'comment';
    return { platform: '问答站', site, kind, type, title: subject, label: '' };
  }
  if (channel.startsWith('论坛')) return { platform: '论坛', site, kind, type: 'post', title: subject.replace(/^(\[[^\]]+\]\s*)+/, ''), label: '' };
  if (channel.startsWith('邮件列表')) return { platform: '邮件列表', site, kind, type: 'mail', title: subject, label: '' };
  if (channel.startsWith('博客')) return { platform: '博客', site, kind, type: 'comment', title: subject, label: '' };
  if (channel === 'Mastodon') return { platform: 'Mastodon', site: '', kind, type: 'post', title: subject, label: '' };
  return { platform: channel || '来源', site, kind, type: null, title: subject, label: '' };
}

const mentionOf = text => String(text || '').match(/^\s*@([\w.-]+?)(?:@[\w.-]+)?[\s:,]/)?.[1] || null;
const short = (text, max = 34) => { const value = String(text || '').trim(); return value.length > max ? `${value.slice(0, max - 1)}…` : value; };

/** The person's own move at the source, as a sentence: “在 GitHub 上批准了 #13528”. */
export function actionText(event) {
  const family = familyMove(event);
  if (family) return { verb: family, object: '', title: '', platform: '家里', sentence: family };
  const ref = eventRef(event), text = event.text || '', mention = mentionOf(text);
  let verb, object = ref.label;
  if (ref.platform === 'GitHub') {
    if (/approved this pull request/.test(text)) verb = '批准了';
    else if (/requested changes/.test(text)) verb = '要求修改';
    else if (/ merged this\b/.test(text) || (ref.type === 'pr' && /closed this in [0-9a-f]{6,}/.test(text))) verb = '合并了';
    else if (/closed this in [0-9a-f]{6,}/.test(text)) verb = '用提交关闭了';
    else if (/closed this as /.test(text)) verb = '关闭了';
    else if (/reopened this/.test(text)) verb = '重新打开了';
    else if (ref.kind === 'gh-t') { verb = ref.type === 'pr' ? '提交了 PR' : '开了 issue'; }
    else if (ref.kind === 'gh-d') verb = '发起了讨论';
    else if (ref.kind === 'gh-r') verb = '评审了';
    else verb = mention ? `回复了 ${mention} ·` : '回复了';
    return { verb, object, title: ref.title, platform: 'GitHub', sentence: `在 GitHub 上${verb} ${object}`.trim() };
  }
  const where = { 问答站: '在问答站', 论坛: '在论坛', 邮件列表: '在邮件列表', 博客: '在博客', Mastodon: '在 Mastodon 上' }[ref.platform] || `在${ref.platform}`;
  const reply = /^Re:/i.test(event.subject || '') || ref.type === 'comment';
  if (ref.platform === '问答站') verb = ref.type === 'question' ? '提问' : ref.type === 'answer' ? '回答' : mention ? `回复了 ${mention}` : '回了一条评论';
  else if (ref.platform === '邮件列表') verb = reply ? '回信' : '发信';
  else if (ref.platform === 'Mastodon') verb = mention ? `回复了 ${mention}` : reply ? '回复' : '发帖';
  else verb = mention ? `回复了 ${mention}` : ref.platform === '论坛' ? '回帖' : '留言';
  return { verb, object: '', title: ref.title, platform: ref.platform, sentence: `${where}${verb}` };
}

/** What an approve ask would do, with the PR's own title from the inputs so far: { number, title }. */
export function approveSubject(ask, upto) {
  const number = String(ask?.subject?.label || '').match(/#(\d+)/)?.[1];
  if (!number) return null;
  for (let index = Math.min(upto, scenario.frames.length - 1); index >= 0; index -= 1) {
    for (const event of scenario.frames[index].events) {
      const ref = eventRef(event);
      if (ref.number === number && ref.title) return { number, title: ref.title, verb: /合并/.test(ask.subject.label) ? '合并' : '执行' };
    }
  }
  return { number, title: '', verb: /合并/.test(ask.subject.label) ? '合并' : '执行' };
}

/** Who wrote an input, with the person always under one name. */
export function authorOf(event) {
  if (event.self) return { name: personName, self: true, tag: '' };
  return { name: event.from || '未署名', self: false, tag: event.author_kind === 'bot' ? '机器' : event.author_kind === 'automation' ? '自动' : '' };
}

/** The ask that was registered for a target at or before a frame (any version). */
export function askAt(index, target) {
  for (let i = index; i >= 0; i -= 1) { const ask = scenario.frames[i].asks?.[target]; if (ask) return ask; }
  return null;
}

/**
 * How one feedback link reads next to its input. A reply answers a registered question only when
 * the link names that ask; otherwise it is filed under the item and never claims to answer it.
 */
export function feedbackLine(event, link, index, state) {
  const item = getItem(state, link.target) || getItem(records[index].state, link.target);
  const title = item?.title || link.target;
  const ask = link.ask ? askAt(index, link.target) : null;
  const answers = Boolean(ask && ask.id === link.ask);
  const action = (answers && ask.actions.find(entry => entry.id === link.action))
    || scenario.feedback?.sourceActions?.find(entry => entry.id === link.action)
    || scenario.feedback?.defaults?.find(entry => entry.id === link.action);
  const via = link.via === 'source' ? actionText(event).sentence : link.via === 'button' ? '在 Fold 里按了按钮' : '回复了 Agent';
  const open = !answers && askAt(index, link.target);
  return {
    via, title, target: link.target, answers,
    choice: answers ? (action?.meaning === 'input' ? '补充了一句' : `「${action?.label || link.action}」`) : '',
    prompt: answers ? ask.prompt : '',
    // The question stays open when a reply to someone else lands on the same item.
    stillOpen: Boolean(open && open.id !== link.ask && currentAskFor(index, link.target)),
  };
}
const currentAskFor = (index, id) => currentAsk({ index, state: records[index].state }, id);

// ---------- 2. folding ----------

/**
 * The root layer, with one-share items that ask nothing folded into one block. `keep` names items that
 * must stay as their own tile (selected, or answered on this page). Returns layout entries in rank order.
 */
export function foldLayer(layer, s, { keep = new Set(), minCount = 3, maxShare = 1 } = {}) {
  const items = layer.items.filter(item => item.status === undefined || item.status === 'active');
  const small = items.filter(item => item.share <= maxShare && !currentAsk(s, item.id) && !keep.has(item.id) && !item.children);
  if (small.length < minCount) return { entries: items, tail: [], tailShare: 0 };
  const tailIds = new Set(small.map(item => item.id));
  const main = items.filter(item => !tailIds.has(item.id));
  const tailShare = small.reduce((sum, item) => sum + item.share, 0);
  // The block reads last, after every item that stands on its own; its area is the exact sum of its shares.
  const tailEntry = { id: TAIL_ID, share: tailShare, status: 'active', rank: main.length + 1, isTail: true };
  return { entries: [...main, tailEntry], tail: small, tailShare };
}

/** Every open ask in the state, most urgent first. Urgency: overdue or due within a day doubles the share. */
export function openAsks(s, { prefer = null } = {}) {
  const now = Date.parse(s.now || s.frame?.at || new Date(s.cursor).toISOString());
  const list = [];
  const walk = layer => { for (const item of layer?.items || []) { const ask = currentAsk(s, item.id); if (ask) list.push({ item, ask: normalizeAsk(ask), raw: ask }); walk(item.children); } };
  walk(s.state.root);
  for (const entry of list) {
    const due = entry.ask.due_at ? Date.parse(entry.ask.due_at) : null;
    entry.due = due; entry.overdue = due !== null && due < now; entry.soon = due !== null && !entry.overdue && due - now < 24 * HOUR;
    entry.score = entry.item.share * (entry.overdue || entry.soon ? 2 : 1) + (prefer && entry.ask.expects === prefer ? 0.5 : 0);
  }
  return list.sort((a, b) => b.score - a.score || (a.due ?? Infinity) - (b.due ?? Infinity)
    || Date.parse(b.ask.registered_at || 0) - Date.parse(a.ask.registered_at || 0));
}

/** “已过 2 天” / “还有 5 小时” for an ask's own deadline. */
export function dueText(entry, now) {
  if (entry.due === null || entry.due === undefined) return '';
  const delta = entry.due - now, abs = Math.abs(delta);
  const span = abs >= 86400000 ? `${Math.round(abs / 86400000)} 天` : abs >= HOUR ? `${Math.round(abs / HOUR)} 小时` : `${Math.max(1, Math.round(abs / 60000))} 分钟`;
  return delta < 0 ? `截止已过 ${span}` : `${span}后截止 · ${stamp(entry.due)}`;
}

// ---------- 3. history ----------

/** The versions of one item up to a frame: every replayed round that changed it, with its full text then. */
export function itemVersions(id, upto) {
  const versions = [];
  for (const record of records) {
    if (record.index > upto) break;
    const change = record.diff.changes.find(entry => entry.item === id && entry.type !== 'annotations_changed');
    if (!change) continue;
    const item = getItem(record.state, id);
    versions.push({ index: record.index, at: record.frame.at, type: change.type, fields: change.fields,
      title: item?.title, summary: item?.summary, share: item?.status === 'active' ? item.share : 0, kind: item?.kind, status: item?.status,
      before: change.before });
  }
  return versions;
}

// ---------- 4. answers ----------

/**
 * Page-local answers. One record per answered item version (respond.mjs); lookups go by item and ask,
 * so an answer stays visible after the Agent rewrites the item in the next round.
 */
export function createAnswerBook(frames = scenario.frames) {
  const store = createResponseStore();
  return {
    store,
    find(itemId, cursor, askId = null) {
      return store.list(cursor).filter(record => record.item === itemId && (!askId || !record.ask || record.ask === askId))
        .sort((a, b) => b.at - a.at)[0] || null;
    },
    status: (record, cursor) => responseStatus(record, frames, cursor),
    save: (item, ask, action, cursor, extra = {}) => store.save(item, action, { ask, at: cursor, via: 'button', ...extra }),
    undo: record => store.removeKey(record.key),
    list: cursor => store.list(cursor),
    subscribe: fn => store.subscribe(fn),
  };
}

/** “你批准了” / “你选了「打给兽医」” / “明早 09:00 再提醒”. */
export function answerWords(record) {
  if (record.meaning === 'snooze') return `${record.until ? `${formatDate(record.until)} ${formatTime(record.until)}` : '稍后'}再提醒`;
  if (record.meaning === 'input') return `你补充了「${short(record.value ?? record.label, 24)}」`;
  if (record.action === 'approve') return '你批准了';
  if (record.action === 'request-changes' || record.label === '要求修改') return '你要求修改';
  return `你选了「${record.label}」`;
}

// ---------- 5. motion ----------

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const near = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
const union = rects => {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y };
};
const shrunk = (rect, amount = 0.5) => ({ x: rect.x + rect.width * (1 - amount) / 2, y: rect.y + rect.height * (1 - amount) / 2, width: rect.width * amount, height: rect.height * amount });
/** Map a rect from one frame of reference into another (zooming into or out of a tile). */
export const projectRect = (rect, from, to) => ({ x: to.x + (rect.x - from.x) * to.width / from.width, y: to.y + (rect.y - from.y) * to.height / from.height,
  width: rect.width * to.width / from.width, height: rect.height * to.height / from.height });

/**
 * FLIP for a re-rendered list. Elements carrying data-flip-key keep their place in the reader's eye:
 * survivors slide from where they were, a grown element reveals its new part, new ones settle in,
 * removed ones fade where they stood. update(render) measures, calls render() (which may replace
 * innerHTML), then plays. The container must be position: relative.
 */
export function flipList(container, { duration = 280, easing = 'cubic-bezier(.2,.75,.25,1)' } = {}) {
  let ghosts = [], running = [];
  const clear = () => { running.forEach(animation => animation.cancel()); running = []; ghosts.forEach(ghost => ghost.remove()); ghosts = []; };
  return function update(render, { animate = true } = {}) {
    const motion = animate && !reducedMotion() && container.isConnected;
    const box = container.getBoundingClientRect();
    const before = new Map();
    if (motion) for (const el of container.querySelectorAll('[data-flip-key]')) {
      if (el.closest('.flip-list-ghost')) continue;
      const r = el.getBoundingClientRect();
      before.set(el.dataset.flipKey, { x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height, el });
    }
    // Exits are cloned before render so they can fade where they stood.
    const clones = motion ? new Map([...before].map(([key, value]) => [key, value.el.cloneNode(true)])) : new Map();
    clear();
    render();
    if (!motion) return;
    const box2 = container.getBoundingClientRect();
    const seen = new Set();
    const play = (el, frames, options = {}) => { running.push(el.animate(frames, { duration, easing, fill: 'backwards', ...options })); };
    for (const el of container.querySelectorAll('[data-flip-key]')) {
      const key = el.dataset.flipKey, old = before.get(key);
      seen.add(key);
      const r = el.getBoundingClientRect();
      const now = { x: r.left - box2.left, y: r.top - box2.top, width: r.width, height: r.height };
      // New rows wait until what stood there has faded, so two texts never overlap long enough to read as one.
      if (!old) { play(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { delay: duration * 0.4, duration: duration * 0.6 }); continue; }
      const dx = old.x - now.x, dy = old.y - now.y, grow = now.height - old.height;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(grow) < 0.5) continue;
      const frames = [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }];
      if (grow > 0.5) { frames[0].clipPath = `inset(0px 0px ${grow}px 0px)`; frames[1].clipPath = 'inset(0px 0px 0px 0px)'; }
      play(el, frames);
    }
    for (const [key, old] of before) {
      if (seen.has(key)) continue;
      const ghost = clones.get(key);
      ghost.classList.add('flip-list-ghost');
      ghost.removeAttribute('data-flip-key');
      ghost.querySelectorAll('[data-flip-key]').forEach(node => node.removeAttribute('data-flip-key'));
      ghost.inert = true; ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, { position: 'absolute', left: `${old.x}px`, top: `${old.y}px`, width: `${old.width}px`, height: `${old.height}px`, margin: '0', pointerEvents: 'none', zIndex: '0' });
      container.append(ghost);
      ghosts.push(ghost);
      play(ghost, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.98)' }], { duration: duration * 0.4, easing: 'ease-in', fill: 'forwards' });
    }
    const done = ghosts.slice();
    setTimeout(() => done.forEach(ghost => ghost.remove()), duration + 80);
  };
}

/**
 * A board of absolutely placed tiles keyed by id. Each tile is
 *   <div class="{tileClass} …" data-id><div class="flip-shape"></div><div class="flip-body">…html…</div></div>
 * The shape carries the tile's colour and is moved with transform (a plain rectangle scales cleanly);
 * the body holds the text at its final layout and is only translated and clipped, so glyphs never stretch.
 * Tiles whose rectangle and content did not change are not touched. update(entries, options):
 *   entries  [{ id, x, y, width, height, className, html, key, attrs }]  key changes → new body, old one crossfades
 *   options  { animate, links: [{from,to}], zoom: { from, to } (rects for dive/rise), scale (slow motion) }
 *            timing(kind, id, { from, to }) → { delay, duration, easing?, from?, to? } | null  (optional; kind is
 *              'move' | 'enter' | 'exit', times in ms; `from` overrides where an entering tile starts, `to` where a
 *              leaving one goes). Without it every tile moves at once over `duration` × scale, as before.
 *            timer: false  settle only when the animations finish (a host that pauses or pins them mid-way)
 *   returns  the plan: { moves, enters, exits } with each tile's from / to rects (or null when nothing moved)
 * onRender(el, entry) runs after a body is (re)written, so the form can trim text to fit.
 */
export function createFlipBoard(board, { tileClass = 'flip-tile', duration = 320, easing = 'cubic-bezier(.2,.75,.25,1)', onRender = () => {} } = {}) {
  let live = new Map();
  const exiting = new Map();
  let running = [], last = null, timer = null;
  const boardRect = () => { const r = board.getBoundingClientRect(); return { left: r.left, top: r.top }; };
  function visual(el) {
    const shape = el.querySelector(':scope > .flip-shape') || el;
    const r = shape.getBoundingClientRect(), b = boardRect();
    return { x: r.left - b.left, y: r.top - b.top, width: r.width, height: r.height };
  }
  const geometry = el => ({ x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0, width: parseFloat(el.style.width) || 0, height: parseFloat(el.style.height) || 0 });
  function settle() {
    for (const animation of running) animation.cancel();
    running = [];
    clearTimeout(timer);
    board.querySelectorAll(':scope > * > .flip-ghost').forEach(ghost => ghost.remove());
    for (const el of exiting.values()) el.remove();
    exiting.clear();
    board.classList.remove('is-moving');
  }
  function play(el, frames, options) {
    const animation = el.animate(frames, { duration, easing, fill: 'both', ...options });
    running.push(animation);
    return animation;
  }
  const shapeAt = (rect, final) => `translate(${rect.x - final.x}px,${rect.y - final.y}px) scale(${Math.max(0.001, rect.width / final.width)},${Math.max(0.001, rect.height / final.height)})`;
  // The body keeps its final layout; it moves with the shape's top-left corner and is clipped to the shape's size.
  const bodyAt = (rect, final, natural = final) => ({
    transform: `translate(${rect.x - final.x}px,${rect.y - final.y}px)`,
    clipPath: `inset(0px ${Math.max(0, natural.width - rect.width)}px ${Math.max(0, natural.height - rect.height)}px 0px)`,
  });
  // `time` (from the host's timing option) gives one tile its own delay, duration and easing, in ms.
  const timed = (time, fallback) => (time ? { duration: time.duration, delay: time.delay || 0, ...(time.easing ? { easing: time.easing } : {}) } : fallback);
  function moveTile(el, from, to, ghost, scale, time = null) {
    const opts = timed(time, { duration: duration * scale });
    play(el.querySelector(':scope > .flip-shape'), [{ transform: shapeAt(from, to) }, { transform: 'none' }], opts);
    const body = el.querySelector(':scope > .flip-body');
    const settled = { transform: 'translate(0px,0px)', clipPath: 'inset(0px 0px 0px 0px)' };
    if (!ghost) { play(body, [bodyAt(from, to), settled], opts); return; }
    // Content changed: the old text hands over to the new one while the shape moves.
    play(body, [{ ...bodyAt(from, to), opacity: 0, offset: 0 }, { opacity: 0, offset: 0.18 }, { ...settled, opacity: 1, offset: 1 }], opts);
    const natural = { width: ghost.offsetWidth, height: ghost.offsetHeight };
    play(ghost, [{ ...bodyAt(from, to, natural), opacity: 1, offset: 0 }, { opacity: 0, offset: 0.6 }, { ...bodyAt(to, to, natural), opacity: 0, offset: 1 }], opts);
  }
  function enterTile(el, from, to, scale, delay = 0.18, time = null) {
    const t = time ? time.duration : duration * scale, d = time ? time.delay || 0 : t * delay;
    const easing = time?.easing ? { easing: time.easing } : {};
    play(el.querySelector(':scope > .flip-shape'), [{ transform: shapeAt(from, to), opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: t, delay: d, ...easing });
    const body = el.querySelector(':scope > .flip-body');
    play(body, [{ ...bodyAt(from, to), opacity: 0 }, { transform: 'translate(0px,0px)', clipPath: 'inset(0px 0px 0px 0px)', opacity: 1 }], { duration: t, delay: d + t * 0.12, ...easing });
  }
  function exitTile(el, to, scale, time = null) {
    const final = geometry(el), t = time ? time.duration : duration * scale * 0.8, d = time ? time.delay || 0 : 0;
    el.classList.add('is-leaving');
    el.setAttribute('aria-hidden', 'true');
    el.inert = true;
    play(el.querySelector(':scope > .flip-shape'), [{ transform: 'none', opacity: 1 }, { transform: shapeAt(to, final), opacity: 0 }], { duration: t, delay: d, easing: time?.easing || 'cubic-bezier(.4,0,.6,1)' });
    play(el.querySelector(':scope > .flip-body'), [{ opacity: 1 }, { opacity: 0 }], { duration: t * 0.5, delay: d, easing: 'linear' });
  }
  function write(el, entry, animate) {
    const body = el.querySelector(':scope > .flip-body');
    if (animate && body.childElementCount) {
      const ghost = body;
      ghost.className = 'flip-ghost';
      Object.assign(ghost.style, { width: `${ghost.offsetWidth}px`, height: `${ghost.offsetHeight}px` });
      ghost.inert = true;
      ghost.setAttribute('aria-hidden', 'true');
      const fresh = document.createElement('div');
      fresh.className = 'flip-body';
      fresh.innerHTML = entry.html;
      el.append(fresh);
      return ghost;
    }
    body.innerHTML = entry.html;
    return null;
  }
  function update(entries, { animate = true, links = [], zoom = null, scale = 1, timing = null, timer: useTimer = true } = {}) {
    const motion = animate && !reducedMotion() && typeof Element.prototype.animate === 'function';
    // 1. Where every tile is on screen right now, mid-flight included.
    const before = new Map();
    if (motion) {
      for (const [id, record] of live) before.set(id, visual(record.el));
      for (const [id, el] of exiting) if (!before.has(id)) before.set(id, visual(el));
    }
    const revive = new Map(exiting);
    settle();
    // 2. Reconcile by id. A tile that was leaving and comes back reuses its node.
    const next = new Map(), written = [];
    for (const entry of entries) {
      let record = live.get(entry.id);
      if (!record && revive.has(entry.id)) {
        const el = revive.get(entry.id);
        el.classList.remove('is-leaving'); el.removeAttribute('aria-hidden'); el.inert = false;
        board.append(el);
        record = { el, key: null };
      }
      let fresh = false;
      if (!record) {
        const el = document.createElement('div');
        el.innerHTML = '<div class="flip-shape"></div><div class="flip-body"></div>';
        board.append(el);
        record = { el, key: null };
        fresh = true;
      }
      const el = record.el, rect = { x: entry.x, y: entry.y, width: entry.width, height: entry.height };
      const old = geometry(el);
      el.className = `${tileClass} ${entry.className || ''}`.trim();
      el.dataset.id = entry.id;
      for (const [name, value] of Object.entries(entry.attrs || {})) {
        if (value === null || value === undefined || value === false) el.removeAttribute(name); else el.setAttribute(name, String(value));
      }
      Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      for (const [name, value] of Object.entries(entry.style || {})) el.style.setProperty(name, value);
      const resized = Math.abs(old.width - rect.width) > 0.5 || Math.abs(old.height - rect.height) > 0.5;
      let ghost = null;
      if (fresh || record.key !== entry.key || resized) {
        ghost = write(el, entry, motion && !fresh && before.has(entry.id));
        record.key = entry.key;
        written.push([el, entry]);
      }
      next.set(entry.id, { ...record, rect, ghost, fresh: fresh || !before.has(entry.id) });
    }
    const leaving = [...live].filter(([id]) => !next.has(id));
    for (const [id, el] of revive) if (!next.has(id)) el.remove();
    live = next;
    for (const [el, entry] of written) onRender(el, entry);
    if (!motion) { for (const [, record] of leaving) record.el.remove(); last = null; return null; }
    // 3. Plan and play. Merged sources fly into their target; a dive or rise projects through the anchor.
    const finalRects = new Map([...live].map(([id, record]) => [id, record.rect]));
    const sourcesOf = new Map(), targetOf = new Map();
    for (const { from, to } of links) {
      if (before.has(from) && finalRects.has(to) && !finalRects.has(from)) { targetOf.set(from, to); if (!before.has(to)) sourcesOf.set(to, [...(sourcesOf.get(to) || []), from]); }
      if (before.has(to) && finalRects.has(from) && !finalRects.has(to)) { targetOf.set(to, from); if (!before.has(from)) sourcesOf.set(from, [...(sourcesOf.get(from) || []), to]); }
    }
    const plan = { moves: [], enters: [], exits: [], zoom, links };
    for (const [id, record] of live) {
      const to = record.rect;
      if (!record.fresh && before.has(id) && !zoom) {
        const from = before.get(id);
        if (near(from, to) && !record.ghost) continue;
        moveTile(record.el, from, to, record.ghost, scale, timing ? timing('move', id, { from, to, changed: Boolean(record.ghost) }) : null);
        plan.moves.push({ id, from, to, changed: Boolean(record.ghost) });
      } else {
        const sources = sourcesOf.get(id);
        let from = sources ? union(sources.map(source => before.get(source))) : zoom ? projectRect(to, zoom.to, zoom.from) : shrunk(to, 0.6);
        const time = timing ? timing('enter', id, { from, to, merged: Boolean(sources) }) : null;
        if (time?.from) from = time.from;
        if (record.ghost) { record.ghost.remove(); record.ghost = null; }
        enterTile(record.el, from, to, scale, zoom ? 0.1 : sources ? 0 : 0.18, time);
        plan.enters.push({ id, from, to });
      }
    }
    for (const [id, record] of leaving) {
      const el = record.el, from = before.get(id) || geometry(el);
      let target = targetOf.has(id) ? finalRects.get(targetOf.get(id)) : zoom ? projectRect(from, zoom.from, zoom.to) : shrunk(from, 0.55);
      const time = timing ? timing('exit', id, { from, to: target, merged: targetOf.has(id) }) : null;
      if (time?.to) target = time.to;
      exiting.set(id, el);
      exitTile(el, target, scale, time);
      plan.exits.push({ id, html: el.outerHTML, from, to: target, merged: targetOf.has(id) });
    }
    if (running.length) {
      board.classList.add('is-moving');
      if (useTimer) {
        const longest = timing ? Math.max(...running.map(a => { const t = a.effect.getTiming(); return (t.delay || 0) + Number(t.duration || 0); })) : duration * scale * 1.45;
        timer = setTimeout(settle, longest + 60);
      }
      Promise.allSettled(running.map(animation => animation.finished)).then(() => { if (running.length && running.every(a => a.playState === 'finished')) settle(); });
    }
    last = plan.moves.length || plan.enters.length || plan.exits.length ? plan : null;
    return last;
  }
  /** Play the last transition again on the settled board. */
  function replay(scale = 1) {
    if (!last || reducedMotion()) return false;
    settle();
    for (const { id, from, to } of last.moves) { const record = live.get(id); if (record) moveTile(record.el, from, to, null, scale); }
    for (const { id, from, to } of last.enters) { const record = live.get(id); if (record) enterTile(record.el, from, to, scale); }
    for (const { id, html, to } of last.exits) {
      const holder = document.createElement('div'); holder.innerHTML = html;
      const el = holder.firstElementChild; el.querySelectorAll('.flip-ghost').forEach(ghost => ghost.remove());
      el.classList.remove('is-leaving'); board.append(el); exiting.set(`replay:${id}`, el); exitTile(el, to, scale);
    }
    board.classList.add('is-moving');
    timer = setTimeout(settle, duration * scale * 1.45 + 60);
    return true;
  }
  return {
    update, replay, settle,
    clear() { settle(); for (const record of live.values()) record.el.remove(); live = new Map(); last = null; },
    get canReplay() { return Boolean(last); },
    element: id => live.get(id)?.el || null,
    rect: id => live.get(id)?.rect || null,
    inspect: () => ({ tiles: live.size, running: running.length, exiting: exiting.size, last: last && { moves: last.moves.length, enters: last.enters.length, exits: last.exits.length } }),
  };
}
