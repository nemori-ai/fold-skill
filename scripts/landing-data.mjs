// 入口页（site/landing/）上会出现的每个数，由演示回放现算，写成 site/landing/data.json。
// 只读原型的模块（variants/shared.mjs、variants/inflow.mjs 与它们引用的 scenario / engine），规则与原型同名函数一致，
// 不改原型、不改演示数据。数据集固定为 composite，帧默认 f26；第二段实现时页面只读 data.json，不加载 2 MB 的回放。
//
//   node scripts/landing-data.mjs            # 重写 site/landing/data.json
//   node scripts/landing-data.mjs --check    # 只核对：现算结果与已提交的 data.json 不同就退出 1
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAME = 26;
// The same module URLs the prototype pages use, query included, so the replay is the pages' replay.
const load = rel => { const [file, query] = rel.split('?'); return import(pathToFileURL(path.join(root, 'prototype', file)).href + (query ? `?${query}` : '')); };
const { scenario, records, currentAsk, getItem } = await load('variants/shared.mjs?v=feedback-loop-1');
const { inputsOf } = await load('variants/inflow.mjs');

const frames = scenario.frames;
const sum = xs => xs.reduce((a, b) => a + b, 0);
const median = xs => { const s = [...xs].sort((a, b) => a - b), m = s.length / 2; return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2; };
const v = (value, source) => ({ value, source });
const DAY = 86400000;
const WEIGHT_RANK = { critical: 0, high: 1, normal: 2, low: 3, trace: 4 };
const walk = (layer, out = []) => { for (const it of layer?.items || []) { out.push(it); walk(it.children, out); } return out; };

// Asks open after each frame, newly registered, and closed after your response: forms/sketches/stage.mjs askLife.
const answeredIds = new Set();
let previous = new Map();
const life = frames.map((frame, i) => {
  for (const e of frame.events) for (const l of e.feedback || []) if (l.ask) answeredIds.add(l.ask);
  const open = new Map();
  for (const item of walk(records[i].state.root)) { const ask = currentAsk({ index: i, state: records[i].state }, item.id); if (ask) open.set(ask.id, { ...ask, item: item.id }); }
  const fresh = [...open.values()].filter(a => !previous.has(a.id));
  const closed = [...previous.values()].filter(a => !open.has(a.id));
  const out = { open, fresh, answered: closed.filter(a => answeredIds.has(a.id)) };
  previous = open;
  return out;
});

// The round on screen.
const frame = frames[FRAME], before = frames[FRAME - 1];
const state = records[FRAME].state, prevState = records[FRAME - 1].state;
const s = { index: FRAME, state };
const items = [...state.root.items].sort((a, b) => a.rank - b.rank);
const asks = items.filter(it => currentAsk(s, it.id));
const askIds = new Set(asks.map(it => it.id));
const agent = items.filter(it => !askIds.has(it.id));
const blank = state.root.budget - state.root.used;
const plan = inputsOf(FRAME, null);
const to = g => (!g.target ? 'fold' : askIds.has(g.target) ? 'you' : 'agent');
const census = plan.list.reduce((n, g) => ({ ...n, [to(g)]: (n[to(g)] || 0) + 1 }), {});
const foldedBy = plan.list.filter(g => to(g) === 'fold').reduce((n, g) => ({ ...n, [g.disp]: (n[g.disp] || 0) + 1 }), {});
const cardsFed = asks.filter(it => plan.list.some(g => g.target === it.id)).length;
const from = Date.parse(frame.signal?.window?.from || before.at), until = Date.parse(frame.signal?.window?.to || frame.at);
const streams = frame.events.reduce((n, e) => ({ ...n, [e.stream]: (n[e.stream] || 0) + 1 }), {});
const dueOf = (item, ask) => { const t = Date.parse(ask?.due_at || (item.kind !== 'done' ? item.due_at : '') || ''); return Number.isFinite(t) ? t : null; };
const cursor = Date.parse(frame.at);
// forms/watch.mjs isUrgent: due within 24 hours (overdue included) or weight critical / high.
const urgent = asks.filter(it => { const due = dueOf(it, currentAsk(s, it.id)); return (due != null && due - cursor < DAY) || (WEIGHT_RANK[it.weight] ?? 2) <= 1; });
// forms/trays.mjs: confirm / approve / choose one tap; defer / schedule two; reply one with a suggested line, else two.
const taps = ask => (['defer', 'schedule'].includes(ask.expects) ? 2 : ask.expects === 'reply' ? (ask.suggest ? 1 : 2) : 1);
const prevShare = new Map(prevState.root.items.map(it => [it.id, it.share]));
const lead = urgent[0] && currentAsk(s, urgent[0].id);

// Two weeks.
const rounds = frames.map((f, i) => ({ i, id: f.id, n: f.events.length, initial: f.phase === 'initial' })).filter(r => !r.initial);
const nPerRound = rounds.map(r => r.n);
const disp = {}; for (const f of frames) for (const e of f.events) disp[e.disposition || 'unjudged'] = (disp[e.disposition || 'unjudged'] || 0) + 1;
const askEvents = frames.flatMap(f => f.events.filter(e => (e.feedback || []).some(l => l.ask)));
const via = [...new Set(frames.flatMap(f => f.events.flatMap(e => (e.feedback || []).map(l => l.via))))];
const closures = [];
frames.forEach((f, i) => { for (const a of life[i].answered) {
  const event = askEvents.find(e => e.feedback.some(l => l.ask === a.id));
  closures.push({ frame: f.id, ask: a.short, item: a.item, share: [getItem(records[i - 1].state, a.item)?.share ?? null, getItem(records[i].state, a.item)?.share ?? null],
    response: { at: event.at, stream: event.stream, channel: event.channel, text: String(event.text || '').slice(0, 60) } });
} });
const biggest = closures.reduce((best, c) => ((c.share[0] - (c.share[1] ?? 0)) > (best.share[0] - (best.share[1] ?? 0)) ? c : best));

const minutes = t => Math.round((t - from) / 60000);
/** Where a tick lands: its item's index in beat2.segments, the item's id when it left the root this round, -1 when folded. */
const segmentOf = target => { if (!target) return -1; const i = items.findIndex(it => it.id === target); return i >= 0 ? i : target; };
const data = {
  about: '入口页上出现的每个数。由 scripts/landing-data.mjs 从演示回放现算（只读原型模块，规则与原型同名函数一致）；页面只读本文件，不加载回放。--check 核对本文件与回放一致。',
  dataset: v('composite', 'prototype/data/select.mjs defaultDataset；人物化名、输入为化名改写的真实公开数据，家庭流由作者编写（datasets.composite.notice）'),
  person: v(scenario.persona.name, 'scenario.persona.name'),
  frame: { id: v(frame.id, `scenario.frames[${FRAME}].id`), at: v(frame.at, 'frames[26].at'), title: v(frame.title, 'frames[26].title'),
    window: v([frame.signal?.window?.from || before.at, frame.signal?.window?.to || frame.at], 'frames[26].signal.window（缺省时取上一帧 at 到本帧 at），即“你离开的 12 小时”') },
  budget: v(state.root.budget, 'records[26].state.root.budget（prototype/engine.mjs BUDGET；每层 64 份，从不变）'),
  beat1: {
    n: v(frame.events.length, 'frames[26].events.length；signal.received 同为 ' + frame.signal?.received),
    streams: v(streams, '按 frames[26].events[].stream 计数；车道顺序 work / community / life / family / subscription'),
    context: {
      twoWeeks: v(sum(frames.map(f => f.events.length)), 'Σ frames[].events.length（corpus 的 3217 条是 Σ signal.received，含未收进演示的条目）'),
      rounds: v(rounds.length, 'phase 不是 initial 的帧数'),
      perRound: v({ min: Math.min(...nPerRound), median: median(nPerRound), max: Math.max(...nPerRound) }, '各轮 events.length 的最小、中位、最大'),
    },
    ticks: v(plan.list.map(g => [minutes(g.at), frame.events[g.k].stream, to(g), segmentOf(g.target)]),
      '每条输入一项 [距窗口起点的分钟, stream, 去向 you|agent|fold, 落进的条目在 beat2.segments 里的下标；-1 = 没落进任何一件；字符串 = 落进了本轮离开根层的条目（见 beat2.gone）]；按时间排序；去向的规则同 variants/inflow.mjs inputsOf 与 variants/duo.mjs census'),
  },
  beat2: {
    adopted: v(census.you + census.agent, 'inputsOf(26).list 里 target 不为空的条数 = disposition used 的条数 ' + plan.counts.used),
    toYou: v(census.you, '落进等你回应那几件的输入；E 折叠屏左页“34 条成了右页的 3 件”'),
    cardsFed: v(cardsFed, '本轮有输入落进的等你回应的件数'),
    toAgent: v(census.agent, '落进 Agent 那边条目的输入；E 折叠屏“6 条进了 Agent 那边”'),
    folded: v(census.fold, '没落进任何一件的输入；E 折叠屏“118 条折掉”'),
    foldedBy: v(foldedBy, 'folded 按 disposition 拆分（deferred 暂缓 / noise 噪音 / duplicate 重复）'),
    segments: v(items.map(it => ({ id: it.id, title: it.title, turn: askIds.has(it.id) ? 'you' : 'agent', before: prevShare.get(it.id) ?? 0, share: it.share, weight: it.weight })),
      'records[26].state.root.items 按 rank；before 是 records[25] 的份额（新出现的为 0）；turn = 此刻是否有 currentAsk（variants/shared.mjs）'),
    gone: v(plan.list.filter(g => g.target && !items.some(it => it.id === g.target)).map(g => { const it = records[FRAME].snapshot.items[g.target]; return { id: g.target, title: it?.title ?? null, status: it?.status ?? null, mergedInto: it?.merged_into ?? null }; }),
      '本轮有输入落进、但在 f26 已不在根层的条目（records[26].snapshot.items）；E 折叠屏把这类输入也算进“Agent 那边”'),
    blank: v({ before: 64 - prevState.root.used, now: blank }, '64 − state.root.used，f25 与 f26'),
    account: v({ blank, agent: sum(agent.map(it => it.share)), agentItems: agent.length, you: sum(asks.map(it => it.share)), youItems: asks.length },
      '与 E 折叠屏份额带下的账同一算法（variants/duo.mjs shares）：空余 + Agent 那边 + 等你 = 64'),
  },
  beat3: {
    open: v(asks.length, 'f26 有 currentAsk 的根层条目数；D 手机首页“5 件等你回应”'),
    fresh: v(life[FRAME].fresh.map(a => a.short), 'askLife：f26 开着而 f25 没开的问题；D“新问题 2 个”'),
    urgent: v(urgent.map(it => currentAsk(s, it.id).short), 'forms/watch.mjs isUrgent：24 小时内到期或档位 critical/high；腕上一瞥“1 件要紧”'),
    lead: v(lead && { item: urgent[0].id, short: lead.short, prompt: lead.prompt, due: lead.due_at, actions: (lead.actions || []).map(a => a.label), share: urgent[0].share, weight: urgent[0].weight,
      inputs: plan.list.filter(g => g.target === urgent[0].id).length }, 'frames[26].asks 里这一件的 short / prompt / due_at / actions；share 与 weight 取 state；inputs 是本轮落进它的条数'),
    asks: v(asks.map(it => { const a = currentAsk(s, it.id); return { item: it.id, short: a.short, expects: a.expects, share: it.share, taps: taps(a) }; }), 'f26 开着的问题，按 rank；taps 按 forms/trays.mjs 的规则'),
    taps: v(sum(asks.map(it => taps(currentAsk(s, it.id)))), '回应托盘“6 下答完 5 个问题”'),
    loop: {
      responses: v(askEvents.length, '两周里带 feedback[].ask 的输入条数：你回应了一个登记的问题'),
      via: v(via, 'feedback[].via 的取值：全部是 source，即在原处回应，Agent 下一轮读到'),
      byChannel: v(askEvents.reduce((n, e) => { const k = String(e.channel || e.stream).split(' · ')[0]; return { ...n, [k]: (n[k] || 0) + 1 }; }, {}),
        '这些回应发生在哪里：event.channel 第一段（Telefon 是电话）'),
      asksRegistered: v(new Set(frames.flatMap(f => Object.values(f.asks || {}).map(a => a.id))).size, '两周登记过的不同问题数'),
      closedAfterResponse: v(closures.length, 'askLife.answered 累计：你回应后、下一次整理时关上的问题'),
      example: v(biggest, '让出份额最多的一次关闭：share 是关闭前后两帧这件的份额'),
    },
  },
  twoWeeks: {
    total: v(sum(frames.map(f => f.events.length)), 'Σ frames[].events.length'),
    used: v(disp.used, 'disposition === used 的条数'),
    byDisposition: v(disp, '按 event.disposition 计数'),
    roundsAtFull: v(records.filter((r, i) => i > 0 && r.state.root.used === r.state.root.budget).length, 'state.root.used === 64 的轮数；两周小倍数“13 次用满 64 份”'),
    maxItems: v(Math.max(...records.map(r => r.state.root.items.length)), '同一时刻根层最多的件数'),
  },
};

const file = path.join(root, 'site/landing/data.json');
const text = `${JSON.stringify(data, (key, value) => (key === 'value' && Array.isArray(value) && Array.isArray(value[0]) ? value.map(x => JSON.stringify(x)) : value), 2)
  .replace(/"(\[[^\]]*\])"/g, (m, inner) => inner.replace(/\\"/g, '"'))}\n`;
if (process.argv.includes('--check')) {
  const committed = await readFile(file, 'utf8').catch(() => '');
  if (committed !== text) { console.error('site/landing/data.json 与回放现算的结果不一致；运行 node scripts/landing-data.mjs 重写'); process.exitCode = 1; } else console.log('data.json 与回放一致');
} else {
  await writeFile(file, text);
  console.log(`写入 ${path.relative(root, file)}：${data.frame.id.value} · ${data.beat1.n.value} 条 → 折掉 ${data.beat2.folded.value} · ${data.beat2.account.value.you} 份等你 · ${data.beat3.urgent.value.length} 件要紧`);
}
