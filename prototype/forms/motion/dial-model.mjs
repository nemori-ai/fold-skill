// 份额拨盘的数据层：从其他形式共用的同一份回放（variants/shared.mjs 的 records）逐轮推出画面需要的事实。
// 不读 dial/data.json（那是 ship 步对照用的），不往演示数据里加任何字段；口径与 data.json 的 rules 一致。
import { scenario, records, currentAsk, getItem, formatDate, formatTime, notice } from '../../variants/shared.mjs?v=feedback-loop-1';
import { currentDataset } from '../../data/select.mjs';
// The person's responses are worded the way the other forms word them (D 首页、回应时序、让位图).
import { responseSentence } from '../sketches/stage.mjs';

export { scenario, notice };
export const frames = scenario.frames;
export const dataset = currentDataset();
export const BUDGET = 64;
const RANK = { critical: 0, high: 1, normal: 2, low: 3, trace: 4 };
const DAY = 86400000;

// ---------- hero: three beats, frame ids per dataset (story.md) ----------
const HERO = {
  composite: { b1: 'f01', b2: ['f02', 'f25'], b3: 'f26' },
  story: { b1: 'cold-01', b2: ['cold-02', 'f14'], b3: 'f15' },
};
const indexOf = id => frames.findIndex(frame => frame.id === id);
export const hero = (() => {
  const plan = HERO[dataset];
  const last = frames.length - 1;
  const b1 = plan ? indexOf(plan.b1) : 1;
  const b3 = plan ? indexOf(plan.b3) : last;
  const b2 = plan ? plan.b2.map(indexOf) : [Math.min(2, last), Math.max(2, b3 - 1)];
  return { b1, b2, b3 };
})();

// ---------- lanes: five input streams; the hand-written story has channels only ----------
const STREAMS = [['work', '工作'], ['community', '社区'], ['family', '家庭'], ['life', '生活'], ['subscription', '订阅']];
const hasStreams = frames.some(frame => frame.events.some(event => event.stream));
const STORY_LANES = [
  ['work', '工作', /团队|客户|监控|部署|反馈|合作|招聘|供应商|财务/],
  ['family', '家庭', /家人/],
  ['life', '生活', /物业|同楼|团购|快递|随手记|日历|定时/],
  ['subscription', '订阅', /资讯|促销|官方/],
  ['other', '其他', /./],
];
export const lanes = hasStreams ? STREAMS.map(([id, label]) => ({ id, label })) : STORY_LANES.map(([id, label]) => ({ id, label }));
const laneIndex = event => {
  if (hasStreams) return Math.max(0, STREAMS.findIndex(([id]) => id === event.stream));
  const head = String(event.channel || '').split(' · ')[0];
  return STORY_LANES.findIndex(([, , test]) => test.test(head));
};

// ---------- names ----------
const titleOf = id => {
  for (let i = records.length - 1; i >= 0; i -= 1) { const item = records[i].snapshot.items[id]; if (item) return item.title; }
  return id;
};
export const shortOf = id => {
  const short = scenario.categories?.[id]?.short;
  if (short) return short;
  const title = titleOf(id);
  return [...title].length > 8 ? `${[...title].slice(0, 7).join('')}…` : title;
};
const clip = (text, n) => ([...String(text || '')].length > n ? `${[...String(text)].slice(0, n - 1).join('')}…` : String(text || ''));
const zone = scenario.timeZone || 'Asia/Shanghai';
const md = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, month: 'numeric', day: 'numeric' });
export const dueText = at => `${md.format(new Date(at)).replace(/月/, '/').replace(/日/, '')} ${formatTime(at)} 前`;
export const dayTime = at => `${formatDate(at)} ${formatTime(at)}`;

// ---------- stable order of root items: first seen, then rank in that frame ----------
const firstSeen = new Map();
records.forEach((record, i) => record.state.root.items.forEach((item, rank) => { if (!firstSeen.has(item.id)) firstSeen.set(item.id, i * 1000 + rank); }));
export const orderOf = id => firstSeen.get(id) ?? Infinity;

function rootOf(state, id) {
  let item = getItem(state, id);
  const seen = new Set();
  while (item?.parent_id && !seen.has(item.id)) { seen.add(item.id); item = getItem(state, item.parent_id); }
  return item?.id ?? null;
}

// ---------- one round ----------
const hash = text => { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return (h >>> 0) / 4294967296; };

function urgentAsks(index, state, at) {
  const out = [];
  const walk = layer => { for (const item of layer?.items || []) { const ask = currentAsk({ index, state }, item.id); if (ask) out.push({ item, ask }); walk(item.children); } };
  walk(state.root);
  const dueOf = ({ item, ask }) => { const v = ask.due_at || (item.kind !== 'done' ? item.due_at : null); const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
  const near = x => { const due = dueOf(x); return due != null && due - at < DAY; };
  const urgent = x => near(x) || (RANK[x.item.weight] ?? 2) <= 1;
  const key = x => [RANK[x.item.weight] ?? 2, near(x) ? 0 : 1, dueOf(x) ?? Infinity, -x.item.share];
  const byKey = (a, b) => { const p = key(a), q = key(b); for (let k = 0; k < p.length; k += 1) if (p[k] !== q[k]) return p[k] < q[k] ? -1 : 1; return 0; };
  return { open: out, urgent: out.filter(urgent).sort(byKey), dueOf };
}

let cumulative = 0;
export const rounds = frames.map((frame, index) => {
  const state = records[index].state;
  const at = Date.parse(frame.at);
  const sectors = state.root.items.map(item => ({ id: item.id, share: item.share, short: shortOf(item.id), order: orderOf(item.id) }))
    .sort((a, b) => a.order - b.order);
  const active = new Set(sectors.map(s => s.id));
  const { open, urgent, dueOf } = urgentAsks(index, state, at);
  const top = urgent[0] || null;
  const cursorRoot = top ? rootOf(state, top.item.id) : null;
  const events = frame.events.map((event, k) => {
    const related = (event.relatedIds || []).map(id => rootOf(state, id)).find(id => id && active.has(id)) || null;
    return {
      lane: laneIndex(event), disposition: event.disposition || 'unjudged', root: event.disposition === 'used' ? related : null,
      self: Boolean(event.self) || event.from === scenario.persona?.name, machine: Boolean(event.author_kind),
      // Deterministic variation per event: speed, spawn jitter and the position across its lane.
      r1: hash(`${event.id}:a`), r2: hash(`${event.id}:b`), r3: hash(`${event.id}:c`), k,
    };
  });
  cumulative += frame.events.length;
  const used = events.filter(e => e.disposition === 'used').length;
  const declarations = frame.batch?.declarations || [];
  const prev = index ? records[index - 1].state.root : null;
  const before = new Map((prev?.items || []).map(item => [item.id, item.share]));
  return {
    index, id: frame.id, at, title: frame.title, date: dayTime(frame.at), initial: frame.phase === 'initial',
    sectors, allocated: state.root.used, blank: BUDGET - state.root.used,
    events, inputs: events.length, used, declarations: declarations.length, cumulative,
    byLane: lanes.map((_, lane) => events.filter(e => e.lane === lane).length),
    openAsks: open.length, urgent: urgent.length,
    cursor: top ? { ask: top.ask.id, root: cursorRoot, short: clip(top.ask.short || top.ask.prompt, 18), due: dueOf(top) ? dueText(dueOf(top)) : null } : null,
    // Other open questions mark their root sectors with a small dark-vermilion tick.
    askRoots: [...new Set(open.map(x => rootOf(state, x.item.id)).filter(id => id && id !== cursorRoot))],
    related: cursorRoot ? events.filter(e => e.root === cursorRoot) : [],
    changed: sectors.filter(s => before.get(s.id) !== s.share).map(s => s.id),
    window: frame.signal?.window || null,
    // Fragments for the concept layer: field names and values from this round's declarations, truncated.
    fragments: declarations.map(d => [`${d.relation || 'update'}`.split(':')[0], clip(d.id, 14), d.weight || '', d.kind || ''].filter(Boolean).join(' · ')),
    channels: frame.events.slice(0, 80).map(e => `${clip(String(e.channel || '').split(' · ')[0], 10)} · ${e.disposition || '—'} · ${clip((e.relatedIds || [])[0] || '', 12)}`),
    review: frame.signal?.type === 'review',
  };
});

/** Root share sizes of round i as a Map (id → share). */
export const sizesOf = i => new Map(rounds[i].sectors.map(s => [s.id, s.share]));

// ---------- one item in one round: what hovering and opening a sector shows ----------
// Everything comes from the same replay the ring is drawn from: the round's events (and their relatedIds), the
// state's items with their children, the registered asks (currentAsk) and the person's feedback links. Nothing new.
function subtreeOf(snapshot, id) {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const item of Object.values(snapshot.items)) if (item.parent_id && out.has(item.parent_id) && !out.has(item.id)) { out.add(item.id); grew = true; }
  }
  return out;
}
const sourceOf = event => String(event.channel || '').split(' · ')[0] || '来源';
const factCache = new Map();
/** Facts about root item `id` in round i: name, share and its change, streams, inputs, open asks, responses, trend. */
export function itemFacts(i, id) {
  const key = `${i}:${id}`;
  if (factCache.has(key)) return factCache.get(key);
  const r = rounds[i], prev = rounds[Math.max(0, i - 1)];
  const record = records[i], state = record.state, stored = record.snapshot.items[id];
  const live = getItem(state, id);
  const share = r.sectors.find(s => s.id === id)?.share ?? 0;
  const before = i > 0 ? prev.sectors.find(s => s.id === id)?.share ?? 0 : 0;
  const change = i === 0 ? null
    : !before && share ? { kind: 'new', text: `新增 ${share} 份` }
      : before && !share ? { kind: 'gone', text: stored?.status === 'merged' ? `撤下 · 并入${shortOf(stored.merged_into)}` : `撤下 · 原 ${before} 份` }
        : share > before ? { kind: 'up', text: `变大 ${before} → ${share}` }
          : share < before ? { kind: 'down', text: `变小 ${before} → ${share}` } : { kind: 'same', text: `不变 ${share} 份` };
  // Which stream feeds it: the lanes of every input taken into it so far (a second one if it brings a third as many).
  const perLane = lanes.map(() => 0);
  for (let k = 1; k <= i; k += 1) for (const e of rounds[k].events) if (e.root === id) perLane[e.lane] += 1;
  const ranked = perLane.map((n, lane) => ({ n, lane })).filter(x => x.n).sort((a, b) => b.n - a.n);
  const stream = ranked.filter((x, k) => !k || x.n * 3 >= ranked[0].n).slice(0, 2).map(x => lanes[x.lane].label);
  // This round's inputs taken into it, with the source and a clipped title from the original event.
  const inputs = r.events.filter(e => e.root === id).map(e => {
    const event = frames[i].events[e.k];
    return { k: e.k, lane: e.lane, at: Date.parse(event.at), source: sourceOf(event), from: event.from || '', self: e.self,
      title: clip(String(event.subject || event.text || '').replace(/\s+/g, ' ').trim(), 30) };
  });
  // Open questions on it or anything under it (currentAsk: registered for the item's current version).
  const asks = [];
  const walk = node => {
    if (!node) return;
    const ask = currentAsk({ index: i, state }, node.id);
    if (ask) asks.push({ id: ask.id, item: node.id, short: clip(ask.short || ask.prompt, 18), prompt: ask.prompt, due: ask.due_at ? dueText(Date.parse(ask.due_at)) : null, cursor: r.cursor?.ask === ask.id });
    for (const child of node.children?.items || []) walk(child);
  };
  walk(live);
  asks.sort((a, b) => b.cursor - a.cursor);
  // The person's responses to it or anything under it, up to this round.
  const ids = subtreeOf(record.snapshot, id);
  const feedback = [];
  for (let k = 1; k <= i; k += 1) {
    for (const event of frames[k].events) for (const link of event.feedback || []) if (ids.has(link.target)) feedback.push({ at: Date.parse(event.at), round: k, text: responseSentence(event, link) });
  }
  const value = {
    id, i, short: shortOf(id), title: (live || stored)?.title || titleOf(id), summary: (live || stored)?.summary || '',
    share, before, change, stream, inputs, asks, feedback,
    children: (live?.children?.items || []).map(c => ({ title: c.title, share: c.share })),
    // Root share in every round (0 when it is not on the ring); the detail draws rounds after i faintly.
    trend: rounds.map(x => x.sectors.find(s => s.id === id)?.share ?? 0),
    // Which of the round's four phases touched it: inputs came in, were taken in, its share moved, it asks you.
    phases: [inputs.length > 0, inputs.length > 0, Boolean(change) && change.kind !== 'same', asks.length > 0],
  };
  factCache.set(key, value);
  return value;
}
