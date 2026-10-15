// Shared parts of the polished retrospective forms: 01 身份线、02 回应时序（完整版）与 08 两周小倍数.
//
// - facts over the whole replay: each item's versions grouped into stations, stream, cumulative share,
//   the eight items that get a colour;
// - ask paths: when a registered question opened, every re-registration, the person's answers, and how
//   it closed (answered, replaced, lapsed after a rewrite, withdrawn with its item) — derived from
//   frame.asks and the item versions, because the replay has no explicit lifecycle;
// - responses written as action sentences ("你在 GitHub 上批准了 #13528"), originals only on demand;
// - the item dossier (summary, reason, ask record, versions, sources with originals);
// - motion: one tween helper that honours prefers-reduced-motion, render timing in window.foldPerf;
// - the page frame of the two sketches: frame bar with play, scrubber, keyboard, URL state.
import { scenario, records, escapeHTML, formatDate, formatTime, kindLabel, notice } from '../../variants/shared.mjs?v=feedback-loop-1';
import { frames, at, categoryName, chosenFrame, rootOf, personName } from './kit.mjs';
import { followFrames } from '../../embed.mjs';

export const esc = escapeHTML;
export { scenario, records, frames, at, formatDate, formatTime, kindLabel, categoryName, rootOf, personName, notice };
export const dayTime = value => `${formatDate(value)} ${formatTime(value)}`;
const HOUR = 3600000;
export function span(ms) {
  const abs = Math.abs(ms), m = Math.round(abs / 60000), h = Math.floor(abs / HOUR), d = Math.floor(abs / (24 * HOUR));
  if (abs < HOUR) return `${Math.max(1, m)} 分钟`;
  if (abs < 48 * HOUR) return `${h} 小时`;
  const rest = Math.floor((abs - d * 24 * HOUR) / HOUR);
  return rest ? `${d} 天 ${rest} 小时` : `${d} 天`;
}
export const openFor = ms => (ms < 60000 ? '刚登记' : `已开 ${span(ms)}`);

// ---------- events, streams, items ----------

const eventIndex = new Map();
frames.forEach((frame, index) => frame.events.forEach(event => eventIndex.set(event.id, { event, frame: index })));
export const eventById = id => eventIndex.get(id)?.event || null;
const refEvent = ref => (typeof ref === 'string' && ref.startsWith('event:') ? eventById(ref.slice(6)) : null);

export const STREAMS = {
  work: { label: '工作', color: '#2f5f9e' },
  life: { label: '生活', color: '#d0782c' },
  community: { label: '社区', color: '#1d9a7e' },
  subscription: { label: '订阅', color: '#8f8a7d' },
};
export const hasStreams = frames.some(frame => frame.events.some(event => event.stream));

/** Per item: the snapshot record in every frame (null before it exists), plus derived facts. */
export const facts = new Map();
records.forEach((record, index) => {
  for (const item of Object.values(record.snapshot.items)) {
    if (!facts.has(item.id)) facts.set(item.id, { id: item.id, hist: Array(records.length).fill(null), cum: 0, first: index, last: index });
    const fact = facts.get(item.id);
    fact.hist[index] = item;
    if (item.status === 'active') { fact.last = index; if (!item.parent_id) fact.cum += item.share; }
  }
});
for (const fact of facts.values()) {
  const counts = {};
  for (const item of fact.hist) for (const source of item?.sources || []) {
    const stream = refEvent(source.ref)?.stream;
    if (stream) counts[stream] = (counts[stream] || 0) + 1;
  }
  fact.ownStream = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  fact.parent = fact.hist.find(Boolean)?.parent_id || null;
}
export const streamOf = id => facts.get(rootOf(id))?.ownStream || facts.get(id)?.ownStream || null;
export const factOf = id => facts.get(id);
/** The item as recorded at frame `index`, else its nearest earlier record, else its first one. */
export function itemAt(id, index) {
  const hist = facts.get(id)?.hist;
  if (!hist) return null;
  for (let i = Math.min(index, hist.length - 1); i >= 0; i -= 1) if (hist[i]) return hist[i];
  return hist.find(Boolean) || null;
}
export const isActive = (id, index) => facts.get(id)?.hist[index]?.status === 'active';
export const rootIds = [...facts.values()].filter(fact => !fact.parent).map(fact => fact.id);

// Eight colours, validated for adjacent-pair separation on the paper surface (dataviz validator:
// normal-vision ΔE ≥ 19.6, CVD ≥ 8.1). They go, in this order, to the eight root items that held the
// most shares over the whole replay; that ranking never changes with the frame, so colours stay put.
export const TOP_PALETTE = ['#2a78d6', '#d9622f', '#1a9a6c', '#c98a00', '#d55181', '#2f7f2f', '#6250d6', '#b8434f'];
export const OTHER_COLOR = '#bdb7a8';
export const topRoots = rootIds.filter(id => facts.get(id).cum > 0)
  .sort((a, b) => facts.get(b).cum - facts.get(a).cum || facts.get(a).first - facts.get(b).first).slice(0, TOP_PALETTE.length);
export const topColor = id => { const k = topRoots.indexOf(id); return k >= 0 ? TOP_PALETTE[k] : null; };

// ---------- versions and stations ----------

const bigrams = text => {
  const chars = [...String(text).replace(/\s+/g, '')], out = new Map();
  for (let i = 0; i < chars.length - 1; i += 1) out.set(chars[i] + chars[i + 1], (out.get(chars[i] + chars[i + 1]) || 0) + 1);
  return out;
};
/** Dice similarity of character bigrams: 1 for the same wording, near 0 for a new sentence. */
export function similarity(a, b) {
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let common = 0, total = 0;
  for (const [k, v] of A) { common += Math.min(v, B.get(k) || 0); total += v; }
  for (const v of B.values()) total += v;
  return total ? 2 * common / total : 1;
}
const declarationFor = (index, id) => frames[index].batch?.declarations?.find(d => d.id === id) || null;
function classify(prev, item) {
  if (!prev) return 'new';
  if (item.status === 'merged' && prev.status !== 'merged') return 'merged';
  if (item.status !== 'active' && prev.status === 'active') return 'withdrawn';
  if (item.status === 'active' && prev.status !== 'active') return 'restored';
  if (item.share !== prev.share || item.kind !== prev.kind) return 'shape';
  if (item.title !== prev.title) return 'title';
  return 'summary';
}
export const CHANGE_WORDS = { new: '新增', merged: '并入', withdrawn: '撤下', restored: '恢复', shape: '改份额或类型', title: '改名', summary: '只改摘要' };
const versionCache = new Map();
/** Every version of an item: a new one whenever its business fields change (updated_at moves). */
export function versionsOf(id) {
  if (versionCache.has(id)) return versionCache.get(id);
  const out = [];
  let prev = null;
  (facts.get(id)?.hist || []).forEach((item, index) => {
    if (!item) return;
    if (!prev || item.updated_at !== prev.updated_at || item.status !== prev.status) {
      const change = classify(prev, item);
      out.push({ index, item, prev, change, reason: declarationFor(index, id)?.reason || null,
        wording: (change === 'title' && similarity(prev.title, item.title) >= 0.7) || change === 'summary' });
    }
    prev = item;
  });
  versionCache.set(id, out);
  return out;
}
const stationCache = new Map();
/** Stations: consecutive versions that only reword the item (same share, kind and status, a title at
 *  least 70% alike) fold into the station before them. */
export function stationsOf(id) {
  if (stationCache.has(id)) return stationCache.get(id);
  const out = [];
  for (const version of versionsOf(id)) {
    const last = out.at(-1);
    if (last && version.wording && last.versions.at(-1).item.status === 'active') { last.versions.push(version); last.end = version.index; }
    else out.push({ index: version.index, end: version.index, change: version.change, versions: [version] });
  }
  for (const station of out) {
    station.first = station.versions[0].item;
    station.last = station.versions.at(-1).item;
    station.names = [...new Set(station.versions.map(v => v.item.title))];
  }
  stationCache.set(id, out);
  return out;
}

// ---------- ask paths ----------

/** One path per ask id: registered at `from`, re-registered on each rewrite, closed at `to`. */
export const askPaths = (() => {
  const byKey = new Map();
  frames.forEach((frame, index) => {
    for (const [itemId, ask] of Object.entries(frame.asks || {})) {
      const key = ask.id || `${itemId}@${frame.id}`;
      if (!byKey.has(key)) byKey.set(key, { key, item: itemId, ask, regs: [], from: index, to: null, end: null, answers: [] });
      const path = byKey.get(key);
      path.regs.push({ index, ask, version: records[index].snapshot.items[itemId]?.updated_at });
      path.ask = ask;
    }
  });
  for (const path of byKey.values()) {
    let version = path.regs[0].version;
    for (let k = path.from + 1; k < frames.length; k += 1) {
      const reg = path.regs.find(r => r.index === k);
      if (reg) { version = reg.version; continue; }
      const item = records[k].snapshot.items[path.item];
      if (!item || item.status !== 'active') { path.to = k; path.end = item?.status === 'merged' ? 'merged' : 'withdrawn'; break; }
      if (item.updated_at !== version) { path.to = k; path.end = frames[k].asks?.[path.item] ? 'replaced' : 'lapsed'; break; }
    }
    path.due = path.ask.due_at || null;
    path.opened = at(path.from);
    path.closed = path.to == null ? null : at(path.to);
  }
  return [...byKey.values()].sort((a, b) => a.from - b.from || (a.item < b.item ? -1 : 1));
})();
export const pathByKey = new Map(askPaths.map(path => [path.key, path]));
export const pathsOfItem = id => askPaths.filter(path => path.item === id);

/** Every feedback link the person gave, in time order, plus host reminders. */
export const responses = [];
export const reminders = [];
frames.forEach((frame, index) => frame.events.forEach(event => {
  (event.feedback || []).forEach((link, n) => {
    const response = { id: `${event.id}#${n}`, index, at: Date.parse(event.at), event, link, item: link.target, path: link.ask && pathByKey.has(link.ask) ? link.ask : null };
    responses.push(response);
    if (response.path) pathByKey.get(response.path).answers.push(response);
  });
  if (event.reminder) reminders.push({ index, at: Date.parse(event.at), event, item: event.reminder.target, ...event.reminder });
}));
responses.sort((a, b) => a.at - b.at);
export const responseById = new Map(responses.map(r => [r.id, r]));

export const CLOSE_WORDS = { answered: '答后关上', replaced: '换成新问题', lapsed: '改写后失效', withdrawn: '随事项撤下', merged: '随事项并入' };
/** How a path stands at frame `index`: open, closed (and how), or not yet registered. */
export function pathStatus(path, index) {
  if (index < path.from) return { state: 'future' };
  if (path.to == null || index < path.to) return { state: 'open' };
  const answered = path.answers.some(r => r.at <= path.closed);
  return { state: 'closed', how: answered ? 'answered' : path.end, end: path.end, answered };
}
/** The deadline that applies to a path: its own due_at, else its item's due_at when registered. */
export function dueOf(path) {
  return path.due || records[path.from].snapshot.items[path.item]?.due_at || null;
}

export const EXPECT_WORDS = { confirm: '确认', choose: '选择', reply: '回复', schedule: '定时间', approve: '批准', defer: '推迟' };
const PLACES = { GitHub: ' GitHub 上', '问答': '问答站上', Mastodon: ' Mastodon 上', '邮件列表': '邮件列表里', '论坛': '论坛里', '博客评论': '博客评论里' };
const VERBS = { approve: '批准了', 'request-changes': '要求修改', merge: '合并了', close: '关闭了', comment: '回复' };
/** One response as an action sentence; the original text is never part of it. */
export function actionSentence(response) {
  const { link, event } = response;
  const path = response.path && pathByKey.get(response.path);
  const label = path?.ask.actions?.find(a => a.id === link.action)?.label
    || scenario.feedback?.sourceActions?.find(a => a.id === link.action)?.label || link.action;
  if (link.via === 'source') {
    const place = PLACES[event.channel.split(' · ')[0]] || `${event.channel.split(' · ')[0]}上`;
    const ref = (event.subject || '').match(/#\d+/)?.[0] || '';
    const verb = VERBS[link.action] ? `${VERBS[link.action]}${ref ? ` ${ref}` : ''}` : `选了「${label}」`;
    return `你在${place}${verb}`;
  }
  if (link.meaning === 'snooze') return `你点了「稍后提醒」${link.until ? `，到 ${dayTime(link.until)} 再提醒` : ''}`;
  if (link.meaning === 'ack') return '你点了「已阅」';
  if (link.via === 'button') return `你在 Fold 里点了「${label}」`;
  return `你回复了 Agent${label && label !== link.action ? `：「${label}」` : ''}`;
}
export const MEANING_WORDS = { decide: '做了决定', input: '补充了信息', act: '报告已做', ack: '已阅', snooze: '稍后提醒' };

// ---------- the dossier ----------

const quoteHTML = (text, href) => `<details class="lv-orig"><summary>看原文</summary><blockquote>${esc(text)}</blockquote>${/^https:\/\//.test(href || '') ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">打开来源 ↗</a>` : ''}</details>`;
function responseHTML(response, current) {
  const path = response.path && pathByKey.get(response.path);
  return `<li class="lv-resp${current ? ' is-current' : ''}" data-resp="${esc(response.id)}"><span class="lv-when">${esc(dayTime(response.event.at))} · ${esc(frames[response.index].id)}</span>
    <b>${esc(actionSentence(response))}</b><small>${path ? `回答了登记的问题：${esc(EXPECT_WORDS[path.ask.expects] || '')}` : '没有回答登记的问题，只记在这件事上'}</small>
    ${response.link.via === 'source' || response.event.text?.length > 40 ? quoteHTML(response.event.text, response.event.url) : ''}</li>`;
}
function pathRecordHTML(path, index, highlight) {
  const status = pathStatus(path, index), now = at(index), due = dueOf(path);
  const rows = [];
  path.regs.filter(r => r.index <= index).forEach((reg, k) => rows.push({ t: at(reg.index), reg: k > 0 ? reg.index : null, html: `<span class="lv-when">${esc(dayTime(frames[reg.index].at))} · ${esc(frames[reg.index].id)}</span>${k ? '条目改写，以同一问题重新登记' : '登记'}` }));
  path.answers.filter(r => r.at <= now).forEach(r => rows.push({ t: r.at, you: true, html: `<span class="lv-when">${esc(dayTime(r.event.at))}</span><b>${esc(actionSentence(r))}</b>${r.link.via === 'source' ? quoteHTML(r.event.text, r.event.url) : ''}` }));
  reminders.filter(r => r.item === path.item && r.at <= now && r.at >= path.opened && (!path.closed || r.at <= path.closed))
    .forEach(r => rows.push({ t: r.at, html: `<span class="lv-when">${esc(dayTime(r.event.at))}</span>◷ 到点提醒（${esc(dayTime(r.requested_at))} 要的）` }));
  if (due && Date.parse(due) <= now) rows.push({ t: Date.parse(due), html: `<span class="lv-when">${esc(dayTime(due))}</span>▼ 期限到${status.state === 'open' || (path.closed && path.closed > Date.parse(due)) ? '，问题还开着' : ''}` });
  if (status.state === 'closed') {
    const reason = { replaced: '同一件事登记了新问题', lapsed: '条目被改写，没有重新登记这个问题', withdrawn: '事项被撤下', merged: '事项并入了另一件' }[path.end];
    rows.push({ t: path.closed, html: `<span class="lv-when">${esc(dayTime(frames[path.to].at))} · ${esc(frames[path.to].id)}</span><b>${esc(CLOSE_WORDS[status.how])}</b>：${esc(reason)}${status.answered && status.how === 'answered' ? '；此前你已回应' : ''}` });
  }
  rows.sort((a, b) => a.t - b.t);
  // Back-to-back re-registrations read as one row: "重新登记 6 次（f02 · f05 …）".
  for (let k = rows.length - 1; k > 0; k -= 1) {
    if (rows[k].reg == null || rows[k - 1].reg == null) continue;
    const run = [...(rows[k - 1].run || [rows[k - 1].reg]), ...(rows[k].run || [rows[k].reg])];
    rows.splice(k - 1, 2, { t: rows[k - 1].t, reg: run[0], run, html: `<span class="lv-when">${esc(dayTime(frames[run[0]].at))} 起</span>条目改写 ${run.length} 次，每次以同一问题重新登记<small class="lv-run">${run.map(i => esc(frames[i].id)).join(" · ")}</small>` });
  }
  const open = status.state === 'open';
  const dueText = due ? `期限 ${dayTime(due)}${open ? `，${Date.parse(due) < now ? `已过 ${span(now - Date.parse(due))}` : `还有 ${span(Date.parse(due) - now)}`}` : ''}` : '没有期限';
  const actions = (path.ask.actions || []).map(a => `<span class="lv-chip${a.recommended ? ' is-rec' : ''}">${esc(a.label)}</span>`).join('');
  return `<article class="lv-path${highlight ? ' is-current' : ''}" data-path="${esc(path.key)}">
    <header><span class="lv-expect">${esc(EXPECT_WORDS[path.ask.expects] || path.ask.expects)}</span><span class="lv-state is-${open ? 'open' : status.how}">${open ? `开着 · ${esc(openFor(now - path.opened))}` : esc(CLOSE_WORDS[status.how])}</span></header>
    <p class="lv-prompt">${esc(path.ask.prompt)}</p>
    ${actions ? `<div class="lv-chips">${actions}</div>` : ''}${path.ask.subject ? `<p class="lv-subject">执行：${esc(path.ask.subject.label)}</p>` : ''}
    <p class="lv-due">${esc(dueText)}${path.ask.expects === 'schedule' || path.ask.expects === 'defer' ? `；${path.answers.some(r => r.at <= now) ? '你已回应' : `还没有${path.ask.expects === 'schedule' ? '选时间' : '推迟'}，也没有到点记录`}` : ''}</p>
    <ol class="lv-log">${rows.map(r => `<li${r.you ? ' class="is-you"' : ''}>${r.html}</li>`).join('')}${open ? `<li class="is-now"><span class="lv-when">此刻 · ${esc(frames[index].id)}</span>仍开着</li>` : ''}</ol></article>`;
}
function versionRowHTML(station, index) {
  const first = station.versions[0], last = station.versions.filter(v => v.index <= index).at(-1);
  const from = first.prev, to = last.item;
  const bits = [];
  if (first.change === 'new') bits.push(`新增 · ${to.share} 份 · ${kindLabel[to.kind] || to.kind}`);
  else if (first.change === 'shape') {
    if (from.share !== first.item.share) bits.push(`${from.share} → ${first.item.share} 份`);
    if (from.kind !== first.item.kind) bits.push(`${kindLabel[from.kind]} → ${kindLabel[first.item.kind]}`);
  } else bits.push(CHANGE_WORDS[first.change]);
  const rewrites = station.versions.filter(v => v.index <= index).length - 1;
  if (rewrites) bits.push(`又改写 ${rewrites} 次措辞`);
  const names = [...new Set(station.versions.filter(v => v.index <= index).map(v => v.item.title))];
  return `<li><span class="lv-when">${esc(frames[first.index].id)} · ${esc(dayTime(frames[first.index].at))}</span><b>${names.map(esc).join(' → ')}</b><small>${esc(bits.join(' · '))}</small>${last.reason ? `<p>${esc(last.reason)}</p>` : ''}</li>`;
}
/** Everything the forms know about one item as of frame `index`. */
export function dossierHTML(id, index, { pathKey = null, responseId = null } = {}) {
  const item = itemAt(id, index);
  if (!item) return '<p>没有找到这件事。</p>';
  const stream = streamOf(id), color = topColor(rootOf(id));
  const status = item.status !== 'active' ? (item.status === 'merged' ? `已并入「${itemAt(item.merged_into, index)?.title || item.merged_into}」` : '已撤下') : `${kindLabel[item.kind] || item.kind} · ${item.share}/64`;
  const notYet = facts.get(id).first > index;
  const paths = pathsOfItem(id).filter(p => p.from <= index).sort((a, b) => (b.key === pathKey) - (a.key === pathKey) || b.from - a.from);
  const own = responses.filter(r => r.item === id && !r.path && r.index <= index);
  const stations = stationsOf(id).filter(s => s.index <= index);
  const versions = versionsOf(id).filter(v => v.index <= index).length;
  const names = new Set(versionsOf(id).filter(v => v.index <= index).map(v => v.item.title)).size;
  const sources = item.sources || [];
  return `<div class="lv-dossier">
    <div class="lv-kicker">${color ? `<i style="background:${color}"></i>` : ''}${stream ? `${esc(STREAMS[stream]?.label || stream)} · ` : ''}${esc(status)} · ${esc(frames[Math.min(index, frames.length - 1)].id)}${notYet ? ' · 此刻还没出现' : ''}</div>
    <h2>${esc(item.title)}</h2>
    <p class="lv-summary">${esc(item.summary || '')}</p>
    ${item.reason ? `<p class="lv-reason"><b>为什么在这里</b>${esc(item.reason)}</p>` : ''}
    ${paths.length ? `<section><h3>回应路径 <small>${paths.length} 条</small></h3>${paths.map(p => pathRecordHTML(p, index, p.key === pathKey)).join('')}</section>` : ''}
    ${own.length ? `<section><h3>你在这件事上的其他动作 <small>${own.length} 条，没有回答登记的问题</small></h3><ol class="lv-resps">${own.slice(-12).reverse().map(r => responseHTML(r, r.id === responseId)).join('')}</ol>${own.length > 12 ? `<p class="lv-more">更早的 ${own.length - 12} 条略去</p>` : ''}</section>` : ''}
    <section><h3>版本 <small>${versions} 版 · ${names} 个名字 · 合成 ${stations.length} 站</small></h3><ol class="lv-versions">${stations.slice().reverse().map(s => versionRowHTML(s, index)).join('')}</ol></section>
    ${sources.length ? `<section><h3>依据 <small>${sources.length} 条来源</small></h3>${sources.map(source => {
      const event = refEvent(source.ref);
      const head = [source.channel, event?.from && (event.self ? `${personName}（你）` : event.from), event && dayTime(event.at)].filter(Boolean).join(' · ');
      return `<article class="lv-source"><small>${esc(head)}</small>${source.quote ? `<p>${esc(source.quote)}</p>` : ''}${event ? quoteHTML(event.text, event.url) : ''}</article>`;
    }).join('')}</section>` : ''}
    <details class="lv-json"><summary>这一版的原始 JSON</summary><pre>${esc(JSON.stringify(item, null, 2))}</pre></details>
  </div>`;
}

// ---------- motion and timing ----------

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = () => motionQuery.matches;
// ?slow=N stretches every animation N times, for frame-by-frame screenshots of a transition.
export const SLOW = Math.max(1, Number(new URLSearchParams(location.search).get('slow')) || 1);
document.documentElement.style.setProperty('--lv-slow', String(SLOW));
export const ease = p => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
/** Run step(eased 0→1) on animation frames; instant when motion is reduced. Returns a cancel function. */
export function tween(duration, step, done) {
  if (reducedMotion() || duration <= 0) { step(1); done?.(); return () => {}; }
  const start = performance.now();
  let raf = 0, live = true;
  const tick = now => {
    if (!live) return;
    const p = Math.min(1, (now - start) / (duration * SLOW));
    timed('ticks', () => step(ease(p)));
    if (p < 1) raf = requestAnimationFrame(tick); else done?.();
  };
  raf = requestAnimationFrame(tick);
  return () => { live = false; cancelAnimationFrame(raf); };
}
/** Render timings in ms: frames (one frame switch), ticks (one animation step), hovers (input → styled). */
export const perf = { frames: [], ticks: [], hovers: [], builds: [] };
globalThis.foldPerf = perf;
export function timed(bucket, fn) {
  const start = performance.now();
  const result = fn();
  perf[bucket].push(performance.now() - start);
  if (perf[bucket].length > 2000) perf[bucket].splice(0, 1000);
  return result;
}
/** Hover latency: from the input event to the frame after the highlight is styled. */
export function markHover(event, probe) {
  const start = event?.timeStamp;
  if (!Number.isFinite(start)) return;
  requestAnimationFrame(() => { if (probe) getComputedStyle(probe).opacity; perf.hovers.push(performance.now() - start); });
}
export function summarize(list) {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b), pick = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: list.length, median: +pick(0.5).toFixed(2), p95: +pick(0.95).toFixed(2), max: +sorted.at(-1).toFixed(2) };
}

// ---------- tooltip and drawer ----------

export function createTip(host, { fixed = false } = {}) {
  const el = document.createElement('div');
  el.className = `lv-tip${fixed ? ' is-fixed' : ''}`;
  el.hidden = true;
  el.setAttribute('role', 'tooltip');
  host.append(el);
  let key = null;
  return {
    show(html, x, y, id = html) {
      if (id !== key) { el.innerHTML = html; key = id; }
      el.hidden = false;
      const box = fixed ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : host.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
      const left = Math.min(Math.max(4, x - box.left + 14), box.width - w - 4);
      const top = y - box.top + 16 + h > box.height ? y - box.top - h - 12 : y - box.top + 16;
      el.style.transform = `translate(${left}px, ${Math.max(4, top)}px)`;
    },
    hide() { el.hidden = true; key = null; },
  };
}

/** A panel that slides over the right edge of `host`; content is the dossier. */
export function createDrawer(host, { onClose, fixed = false } = {}) {
  const el = document.createElement('aside');
  el.className = `lv-drawer${fixed ? ' is-fixed' : ''}`;
  el.setAttribute('aria-label', '详情');
  el.innerHTML = '<button class="lv-drawer-close" aria-label="关闭详情（Esc）">×</button><div class="lv-drawer-body" tabindex="-1"></div>';
  host.append(el);
  const body = el.querySelector('.lv-drawer-body');
  let key = null;
  const api = {
    get isOpen() { return el.classList.contains('is-open'); },
    get key() { return key; },
    open(html, nextKey, { scrollTo } = {}) {
      const same = nextKey === key && api.isOpen;
      const top = body.scrollTop;
      body.innerHTML = html;
      key = nextKey;
      el.classList.add('is-open');
      if (scrollTo) body.querySelector(scrollTo)?.scrollIntoView({ block: 'center' });
      else body.scrollTop = same ? top : 0;
    },
    close() { if (!api.isOpen) return; el.classList.remove('is-open'); key = null; onClose?.(); },
    el,
  };
  el.querySelector('.lv-drawer-close').addEventListener('click', () => api.close());
  return api;
}

// ---------- the sketch page frame ----------

/** Header, frame bar (prev / play / next, scrubber), figure, side column and key for a sketch page. */
export function mountLivePage({ id, no, name, relation, key, storyFrame = frames.length - 1, side = true, onFrame, onKey, playEvery = 1300 }) {
  let index = chosenFrame(id, Math.min(storyFrame, frames.length - 1));
  document.title = `Fold · ${name}`;
  document.body.className = 'lv-page';
  document.body.innerHTML = `<div class="lv" data-form="${esc(id)}">
    <header class="lv-head">
      <div class="lv-kicker"><a href="../index.html">FOLD · 表达形式</a> <b>${String(no).padStart(2, '0')}</b> ${esc(name)} <span class="lv-tag">完整版 · 可逐帧</span></div>
      <h1>${esc(relation)}</h1>
    </header>
    <div class="lv-bar">
      <div class="lv-nav"><button data-lv-step="-1" aria-label="上一帧（←）" title="上一帧 ←">‹</button><button class="lv-play" data-lv-play aria-label="播放（空格）" title="播放 / 暂停 · 空格"><svg width="12" height="12" viewBox="0 0 12 12"><path class="lv-play-icon" d="M3 1.5 L10.5 6 L3 10.5 Z"/><path class="lv-pause-icon" d="M2.5 1.5 h2.6 v9 h-2.6 Z M6.9 1.5 h2.6 v9 h-2.6 Z"/></svg></button><button data-lv-step="1" aria-label="下一帧（→）" title="下一帧 →">›</button></div>
      <div class="lv-clock"><span class="lv-date"></span><span class="lv-title"></span></div>
      <div class="lv-scrub" role="slider" tabindex="0" aria-label="选择帧" aria-valuemin="0" aria-valuemax="${frames.length - 1}">${frames.map((f, i) => `<i data-i="${i}" title="${esc(`${dayTime(f.at)} ${f.title}`)}"${i > 0 && formatDate(f.at) !== formatDate(frames[i - 1].at) ? ' class="is-day"' : ''}></i>`).join('')}<b class="lv-scrub-head"></b></div>
      <button class="lv-help-btn" data-lv-help aria-expanded="false">键盘</button>
      <div class="lv-help" hidden><b>键盘</b><dl><dt>← →</dt><dd>上一帧 / 下一帧</dd><dt>Home End</dt><dd>第一帧 / 最后一帧</dd><dt>空格</dt><dd>播放 / 暂停</dd><dt>↑ ↓</dt><dd>在事项之间移动</dd><dt>Enter</dt><dd>打开详情</dd><dt>Esc</dt><dd>关上详情 / 取消固定</dd>${id === 'lineage' ? '<dt>E</dt><dd>展开或折起长尾</dd>' : ''}</dl></div>
    </div>
    <div class="lv-body${side ? '' : ' no-side'}"><main class="lv-figure" id="figure" tabindex="-1"></main>${side ? '<aside class="lv-side" aria-label="此刻"></aside>' : ''}</div>
    <footer class="lv-key">${key}<span class="lv-notice">${esc(notice)}</span></footer>
  </div>`;
  const $ = s => document.querySelector(s);
  const scrub = $('.lv-scrub'), ticks = [...scrub.querySelectorAll('i')], head = $('.lv-scrub-head');
  let timer = null;
  // Embedded in all.html: the page above steps every prototype together.
  const reportFrame = followFrames(i => setFrame(i));
  function setFrame(next, { from = 'nav' } = {}) {
    next = Math.max(0, Math.min(frames.length - 1, next));
    if (from !== 'play') stop();
    const previous = index;
    index = next;
    const frame = frames[index];
    $('.lv-date').textContent = `${dayTime(frame.at)} · ${frame.id} · ${records[index].state.revision}`;
    $('.lv-title').textContent = frame.title;
    ticks.forEach((t, i) => t.classList.toggle('is-past', i <= index));
    const tick = ticks[index];
    head.style.transform = `translateX(${tick.offsetLeft}px)`;
    scrub.setAttribute('aria-valuenow', String(index));
    scrub.setAttribute('aria-valuetext', `${frame.id} ${dayTime(frame.at)}`);
    const q = new URLSearchParams(location.search);
    q.set('frame', frame.id);
    history.replaceState(null, '', `?${q}`);
    if (previous !== index || from === 'init') onFrame(index, previous, from);
    reportFrame(index);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } $('.lv').classList.remove('is-playing'); }
  function togglePlay() {
    if (timer) { stop(); return; }
    if (index >= frames.length - 1) setFrame(0, { from: 'play' });
    $('.lv').classList.add('is-playing');
    timer = setInterval(() => { if (index >= frames.length - 1) stop(); else setFrame(index + 1, { from: 'play' }); }, playEvery * SLOW);
  }
  // Scrubber: click or drag picks the nearest frame.
  const pick = event => {
    const box = scrub.getBoundingClientRect();
    const x = event.clientX - box.left;
    let best = 0;
    ticks.forEach((t, i) => { if (Math.abs(t.offsetLeft + t.offsetWidth / 2 - x) < Math.abs(ticks[best].offsetLeft + ticks[best].offsetWidth / 2 - x)) best = i; });
    setFrame(best);
  };
  scrub.addEventListener('pointerdown', event => { scrub.setPointerCapture(event.pointerId); pick(event); });
  scrub.addEventListener('pointermove', event => { if (scrub.hasPointerCapture(event.pointerId)) pick(event); });
  document.addEventListener('click', event => {
    const b = event.target.closest('[data-lv-step],[data-lv-play],[data-lv-help]');
    if (!b) return;
    if (b.dataset.lvStep) setFrame(index + Number(b.dataset.lvStep));
    else if ('lvPlay' in b.dataset) togglePlay();
    else { const help = $('.lv-help'); help.hidden = !help.hidden; b.setAttribute('aria-expanded', String(!help.hidden)); }
  });
  const typing = el => el?.matches?.('input,textarea,select,[contenteditable="true"]');
  document.addEventListener('keydown', event => {
    if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (onKey?.(event)) { event.preventDefault(); return; }
    const keys = { ArrowLeft: () => setFrame(index - 1), ArrowRight: () => setFrame(index + 1), Home: () => setFrame(0), End: () => setFrame(frames.length - 1), ' ': () => togglePlay(), '?': () => $('[data-lv-help]').click() };
    if (keys[event.key]) { event.preventDefault(); keys[event.key](); }
  });
  // Space on a focused button should play, not press the button.
  document.addEventListener('keyup', event => { if (event.key === ' ' && !typing(event.target)) event.preventDefault(); });
  return {
    figure: $('#figure'), side: $('.lv-side'), body: $('.lv-body'), root: $('.lv'),
    start() { setFrame(index, { from: 'init' }); },
    get index() { return index; },
    goFrame: next => setFrame(next),
    stop,
  };
}
