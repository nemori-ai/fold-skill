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

// The moment the first screen stands on: everything the Agent has read by f26, one dot per input, and which of them
// each situation's window is made from. An input "feeds" an item when inputsOf(k) sends it there in its round; an item
// merged since is followed to the one it merged into (records[26].snapshot.items[].merged_into).
const snapItems = records[FRAME].snapshot.items;
const settle = id => { let at = id; for (let n = 0; snapItems[at]?.merged_into && n < 20; n += 1) at = snapItems[at].merged_into; return at; };
const urgentIds = new Set(urgent.map(it => it.id));
const nowIds = new Set(items.map(it => it.id));
// 0 never fed an item (noise, duplicate, deferred) · 1 fed an item no longer on the root · 2 fed one the Agent holds
// now · 3 fed one waiting for you now · 4 fed the urgent one.
const levelOf = target => { if (!target) return 0; const id = settle(target); return urgentIds.has(id) ? 4 : askIds.has(id) ? 3 : nowIds.has(id) ? 2 : 1; };
const field = frames.slice(1, FRAME + 1).map((f, j) => inputsOf(j + 1, null).list.map(g => levelOf(g.target)).join(''));
const level = k => sum(field.map(col => [...col].filter(c => Number(c) >= k).length));
const seenEvents = frames.slice(0, FRAME + 1).flatMap(f => f.events);
const channelOf = e => String(e.channel || e.stream).split(' · ')[0];
const byChannel = Object.entries(seenEvents.reduce((n, e) => ({ ...n, [channelOf(e)]: (n[channelOf(e)] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

// ---------- 第 2 节：一个人一天的量级（示意，不是演示数据） ----------
// 第 2 节讲的是一般的问题，不用演示回放：一个普通人一天各个来源进来的条数。能找到公开统计的按统计取整（basis 写链接），
// 找不到的用保守的整数估计（basis 写“估计”，note 写怎么估的、参照了什么）。按条数从多到少；消息类的大群必须明显最多。
// 出处表见 site/landing/story.md「第 2 节 · 为什么是新问题」。
const WTI = 'https://www.microsoft.com/en-us/worklab/work-trend-index/breaking-down-infinite-workday';
const DAY_SOURCES = [
  ['Discord 社区', '消息', 500, '估计', '一个几千人的活跃社区服务器。参照：3,167 个公开服务器 2015–2024 年共 20.5 亿条消息，平均每个约 65 万条（Discord Unveiled，https://arxiv.org/abs/2502.00627）；一个约千名活跃成员的开发者服务器平均每天约 100 条（Raglianti 等 2021，https://discordance.si.usi.ch/files/Raglianti2021a.pdf）'],
  ['业主群', '消息', 300, '估计', '几百人的小区业主微信群（微信群上限 500 人）：报修、团购、闲聊'],
  ['行业群', '消息', 200, '估计', '一两个几百人的同行交流群'],
  ['工作消息', '消息', 150, WTI, '微软 Work Trend Index 2025：平均每个工作日收到 153 条 Teams 消息，取整'],
  ['工作邮件', '邮件', 120, WTI, '同上：平均每天收到 117 封邮件，取整'],
  ['家长群', '消息', 100, '估计', '班级家长群：通知、接龙、一串“收到”'],
  ['新闻订阅', '新闻', 100, '估计', '几个新闻 App 与 RSS 订阅一天的新文章'],
  ['自选股', '行情', 100, '估计', '二三十只自选股的异动、公告与到价提醒'],
  ['智能家居', '家里', 60, '估计', '门锁、摄像头的移动侦测、温湿度与漏水传感器'],
  ['私聊', '消息', 50, '估计', '朋友与家人的一对一消息。参照：微信每天发出 450 亿次信息、月活 10 亿多，人均每天发出四十来条（2018 微信数据报告，https://www.ifanr.com/app/1159885）'],
  ['GitHub 通知', '工作', 40, '估计', '参与几个项目时的评审请求、评论与构建结果'],
  ['社交媒体', '社交', 40, '估计', '点赞、评论、关注的人发帖的提醒'],
  ['个人邮箱', '邮件', 30, '估计', '账单、订阅、促销'],
  ['购物外卖', '生活', 25, '估计', '购物、外卖、打车 App 的订单状态与推送'],
  ['银行支付', '生活', 10, '估计', '每笔消费、转账一条'],
  ['短信', '生活', 10, '估计', '验证码与各类通知'],
  ['快递', '家里', 5, '估计', '参照：2024 年全国快递 1745 亿件（国家邮政局，https://www.news.cn/fortune/20250108/6f53ea991eaf49928307e1c7ac20301d/c.html），人均每天约 0.34 件，一件有几条物流消息；一家人一天几条'],
  ['日历', '生活', 5, '估计', '会议与日程提醒'],
  ['幼儿园 App', '家里', 5, '估计', '班级通知、照片、入园离园签到'],
].map(([name, kind, n, basis, note]) => ({ name, kind, n, basis, note }));
// The one app the section points at (“← 一个软件”).
const ONE_APP = '幼儿园 App';
{
  const top = DAY_SOURCES[0], firstOther = DAY_SOURCES.find(s => s.kind !== '消息');
  const problems = [
    DAY_SOURCES.some((s, i) => i && s.n > DAY_SOURCES[i - 1].n) && 'why.day 没按条数从多到少排',
    top.kind !== '消息' && '最多的一项不是消息类的大群',
    firstOther.n * 2 > top.n && `消息类的大群不够明显地最多（${top.name} ${top.n}，${firstOther.name} ${firstOther.n}）`,
    !DAY_SOURCES.some(s => s.name === ONE_APP) && `why.day 里没有 ${ONE_APP}`,
    DAY_SOURCES.some(s => s.basis !== '估计' && !/^https:\/\//.test(s.basis)) && 'basis 只能是出处链接或“估计”',
  ].filter(Boolean);
  if (problems.length) throw new Error(problems.join('；'));
}
const dayTotal = sum(DAY_SOURCES.map(s => s.n));

// ---------- 入口页的白话说法 ----------
// 用户 2026-11-03：“你要举例，举一点不拗口的，一眼就知道什么意思的。”入口页不直接搬演示原文（瑞典人名、#编号、PR、
// CI、瑞典语），每一件事、每个问题与选项、回流的例子都配一份白话，写进 data.json 的 plain 字段；原文留在旁边，页面只显示
// plain。人名换成角色：Jonas 是“你”，伴侣 Kajsa、女儿 Signe（11 岁）、儿子 Ture（4 岁）、母亲 Mamma、猫 Smilla。
// 白话要忠实于原件：是把原话翻成大白话，不是另编一件事。对照表见 site/landing/story.md「白话对照」。
const PLAIN = {
  // 每件事的短名：桌前那扇窗的格子、第 4 节尺下的“涨 / 让”。6 个字以内。
  items: {
    'driveway-wet': '水管裂了',           // 车道下铜管裂，周一前定修法
    'issue-13587': '审同事的修复',         // #13587重开，修复#13596待你审
    'pr-reviews-0814': '三份旧改动',       // 3个旧PR待审，15日合#13591
    'ci-urls-master': '测试没通过',        // master仍红：Windows持续失败
    'smilla-vet': '猫看病',                // Smilla已减量，24日9:30复诊
    'kajsa-bike-brake': '自行车刹车',      // Kajsa提醒修旧车刹车，新车18日到
    'mamma-stambyte': '妈妈家换水管',      // Mamma选疏散公寓，Ulrika问进展
    'issue-13586': '上传卡住',             // #13586上传卡在65KB，未能复现
    'ture-pickup-0812': '儿子病假',        // Ture已退烧再休一天，记得报vab
    'signe-school-start': '女儿开学',      // Signe 19日开学：签同意书、查头虱
    'signe-comic-talk': '女儿的漫画',      // Signe看的漫画有裸露图，12日谈
    'fan-delivery-0815': '台扇到了',       // 台扇应已送到信箱
    'issue-13466': '另一个毛病',           // #13466另一问题已确认，待另开issue
    'release-8-22-rc1': '新版快发布',      // 8.22.0-rc1已发，9月2日发布
  },
  // 每个开着的问题。
  asks: {
    'driveway-wet': '水管裂了：挖开换还是不挖？', // 主水管：挖开换还是免挖？
    'issue-13587': '同事的修复，批准吗？',       // #13596 计时修复：批准？
    'pr-reviews-0814': '三份旧改动，推到哪天看？', // 三个旧 PR 推到哪天？
    'ture-pickup-0812': '照顾儿子的假，报了吗？',  // VAB 报了吗？（VAB：瑞典照顾生病孩子的带薪假）
    'signe-school-start': '女儿的同意书签了吗？',  // Signe 的同意书签了吗？
  },
  // 要紧的那一问：表盘上两行（各 8 个字以内），卡上的整句与两个选项（与原文的选项同序）。
  lead: {
    item: 'driveway-wet',
    subject: '水管裂了', question: '挖开换还是不挖？',
    prompt: '车道下的水管裂了：挖开整根换（约 6.8 万），还是不挖开、从旧管里穿一根新管（约 4.1 万）？',
    actions: ['挖开换 · 6.8 万', '不挖开 · 4.1 万'], // 整根挖开换 / 免挖穿新管
  },
  // 回流里真实的那一次：Smilla 多吃了药：打诊所？→ 一通打给宠物诊所的电话（Utgående samtal till Djurkliniken Kvarnbacken · 6 min）。
  loop: { item: 'smilla-vet', ask: '猫多吃了药，要打给兽医吗？', response: '打给宠物诊所，6 分钟' },
};
const plainItem = id => { if (!PLAIN.items[id]) throw new Error(`白话缺 ${id}：在 PLAIN.items 里补一条`); return PLAIN.items[id]; };
const plainAsk = id => { if (!PLAIN.asks[id]) throw new Error(`白话缺问题 ${id}：在 PLAIN.asks 里补一条`); return PLAIN.asks[id]; };
// The lead question and the loop's example are written for one item each: a replay that changes them needs new words.
if (PLAIN.lead.item !== urgent[0]?.id || PLAIN.lead.actions.length !== (lead.actions || []).length) throw new Error(`白话的要紧一问写的是 ${PLAIN.lead.item}，回放里是 ${urgent[0]?.id}（${(lead.actions || []).map(a => a.label).join(' / ')}）`);
if (PLAIN.loop.item !== biggest.item) throw new Error(`白话的回流例子写的是 ${PLAIN.loop.item}，回放里是 ${biggest.item}`);
// A deadline in words, read off the replay clock (both times carry the same offset): 明天上午前.
const dueWords = (due, now) => {
  const days = Math.round((Date.parse(due.slice(0, 10)) - Date.parse(now.slice(0, 10))) / DAY);
  const hour = Number(due.slice(11, 13));
  return `${['今天', '明天', '后天'][days] ?? `${days} 天后`}${hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上'}前`;
};

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
  hero: {
    seen: v(seenEvents.length, 'Σ frames[0..26].events.length：到 f26 为止 Agent 读过的输入；D 手机首页底栏“累计 3051 条输入 → 现在 14 件”'),
    sources: v(byChannel.length, 'frames[0..26].events[].channel 第一段（“GitHub · skarv/skarv”记为 GitHub）的不同取值数'),
    span: v([frames[0].at, frame.at], '首屏那片点从哪一刻到哪一刻：frames[0].at（空状态）到 frames[26].at'),
    days: v(Math.round((Date.parse(frame.at) - Date.parse(frames[0].at)) / DAY), '(frames[26].at − frames[0].at) / 1 天'),
    rounds: v(FRAME, 'f01 到 f26 的整理次数（f00 是空状态）'),
    field: v(field, '首屏那片点：f01…f26 每轮一列，列里每条输入一位数字，按到达先后（inputsOf(k).list 的顺序）；0 = 没落进任何一件（噪音、重复、暂缓）、1 = 落进的那件此刻已不在根层、2 = 落进 Agent 此刻在办的一件、3 = 落进此刻等你回应的一件、4 = 落进要紧的那一件；落进的那件后来并入别处时，跟到它并入的那件（records[26].snapshot.items[].merged_into）'),
    lit: v({ used: level(1), now: level(2), you: level(3), urgent: level(4) },
      'field 里各档及以上的条数：used = 两周落进过任何一件（等于 disposition used 的条数），now = 落进此刻根层的 14 件，you = 落进此刻等你的 5 件，urgent = 落进要紧的那一件'),
    dark: v({ urgent: seenEvents.length - level(4), now: seenEvents.length - level(2), used: seenEvents.length - level(1) },
      'seen − lit：各扇窗没用到、原地暗下的条数（骑车 / 桌前 / 复盘）'),
    itemsEver: v(Object.keys(snapItems).length, 'records[26].snapshot.items 的条目数：到 f26 为止到过根层的事（两周小倍数“60 件事到过根层”）'),
    review: v(records.slice(1, FRAME + 1).map((r, j) => [frames[j + 1].id, r.state.root.used, [...r.state.root.items].sort((a, b) => a.rank - b.rank).map(it => it.share)]),
      '复盘那扇窗：f01…f26 每轮一项 [帧号, 已用份数, 根层各件的份额（按 rank）]，records[k].state.root'),
  },
  why: {
    day: v(DAY_SOURCES, '第 2 节：一个人一天各个来源进来的条数，示意的量级，不是演示数据；basis 是出处链接或“估计”，note 写怎么得来（scripts/landing-data.mjs DAY_SOURCES）'),
    total: v(dayTotal, 'Σ why.day[].n：Agent 替这个人看着全部来源，一天要读的条数'),
    widest: v(DAY_SOURCES[0].n, 'why.day 里最多的一项：第 1 幕的比例按它定（它占满一行）'),
    oneApp: v(DAY_SOURCES.findIndex(s => s.name === ONE_APP), `标“← 一个软件”的那一行在 why.day 里的下标（${ONE_APP}）`),
    demoPerDay: v(Math.round(seenEvents.length / Math.round((Date.parse(frame.at) - Date.parse(frames[0].at)) / DAY)), '演示里平均一天的条数：hero.seen / hero.days（第 2 节导语“演示里一天两百来条”）'),
  },
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
    segments: v(items.map(it => { const due = dueOf(it, currentAsk(s, it.id)); return { id: it.id, title: it.title, plain: plainItem(it.id), turn: askIds.has(it.id) ? 'you' : 'agent', before: prevShare.get(it.id) ?? 0, share: it.share, weight: it.weight, due: due == null ? null : new Date(due).toISOString() }; }),
      'records[26].state.root.items 按 rank；plain 是入口页上的白话短名（PLAIN.items）；before 是 records[25] 的份额（新出现的为 0）；turn = 此刻是否有 currentAsk（variants/shared.mjs）；due 取问题的 due_at，没有时取条目的 due_at（forms/watch.mjs dueOf）'),
    gone: v(plan.list.filter(g => g.target && !items.some(it => it.id === g.target)).map(g => { const it = records[FRAME].snapshot.items[g.target]; return { id: g.target, title: it?.title ?? null, status: it?.status ?? null, mergedInto: it?.merged_into ?? null }; }),
      '本轮有输入落进、但在 f26 已不在根层的条目（records[26].snapshot.items）；E 折叠屏把这类输入也算进“Agent 那边”'),
    blank: v({ before: 64 - prevState.root.used, now: blank }, '64 − state.root.used，f25 与 f26'),
    account: v({ blank, agent: sum(agent.map(it => it.share)), agentItems: agent.length, you: sum(asks.map(it => it.share)), youItems: asks.length, used: state.root.used, items: items.length },
      '与 E 折叠屏份额带下的账同一算法（variants/duo.mjs shares）：空余 + Agent 那边 + 等你 = 64；used 是 state.root.used（原版树图“已用 63 / 64”）'),
    yielded: v(items.filter(it => (prevShare.get(it.id) ?? 0) !== it.share).map(it => ({ id: it.id, before: prevShare.get(it.id) ?? 0, share: it.share, delta: it.share - (prevShare.get(it.id) ?? 0) })),
      '本轮份额变了的条目：f25 → f26 的份数与差'),
  },
  dueAhead: v(items.map(it => ({ id: it.id, due: dueOf(it, currentAsk(s, it.id)), you: askIds.has(it.id) })).filter(x => x.due != null && x.due > cursor).sort((a, b) => a.due - b.due)
    .map(x => ({ id: x.id, you: x.you, hours: Math.round((x.due - cursor) / 3600000) })), 'f26 此刻之后才到期的条目，按先后；hours 是距 frames[26].at 的小时数（B 时间展开的“此刻线之后”）'),
  beat3: {
    open: v(asks.length, 'f26 有 currentAsk 的根层条目数；D 手机首页“5 件等你回应”'),
    fresh: v(life[FRAME].fresh.map(a => a.short), 'askLife：f26 开着而 f25 没开的问题；D“新问题 2 个”'),
    urgent: v(urgent.map(it => currentAsk(s, it.id).short), 'forms/watch.mjs isUrgent：24 小时内到期或档位 critical/high；腕上一瞥“1 件要紧”'),
    lead: v(lead && { item: urgent[0].id, short: lead.short, prompt: lead.prompt, due: lead.due_at, actions: (lead.actions || []).map(a => a.label), share: urgent[0].share, weight: urgent[0].weight,
      inputs: plan.list.filter(g => g.target === urgent[0].id).length,
      plain: { subject: PLAIN.lead.subject, question: PLAIN.lead.question, prompt: PLAIN.lead.prompt, actions: PLAIN.lead.actions, due: dueWords(lead.due_at, frame.at) } },
      'frames[26].asks 里这一件的 short / prompt / due_at / actions；share 与 weight 取 state；inputs 是本轮落进它的条数；plain 是入口页的白话（PLAIN.lead，选项与 actions 同序；due 是 due_at 距 frames[26].at 的说法）'),
    asks: v(asks.map(it => { const a = currentAsk(s, it.id); return { item: it.id, short: a.short, plain: plainAsk(it.id), expects: a.expects, share: it.share, taps: taps(a) }; }), 'f26 开着的问题，按 rank；plain 是白话（PLAIN.asks）；taps 按 forms/trays.mjs 的规则'),
    taps: v(sum(asks.map(it => taps(currentAsk(s, it.id)))), '回应托盘“6 下答完 5 个问题”'),
    loop: {
      responses: v(askEvents.length, '两周里带 feedback[].ask 的输入条数：你回应了一个登记的问题'),
      via: v(via, 'feedback[].via 的取值：全部是 source，即在原处回应，Agent 下一轮读到'),
      byChannel: v(askEvents.reduce((n, e) => { const k = String(e.channel || e.stream).split(' · ')[0]; return { ...n, [k]: (n[k] || 0) + 1 }; }, {}),
        '这些回应发生在哪里：event.channel 第一段（Telefon 是电话）'),
      asksRegistered: v(new Set(frames.flatMap(f => Object.values(f.asks || {}).map(a => a.id))).size, '两周登记过的不同问题数'),
      closedAfterResponse: v(closures.length, 'askLife.answered 累计：你回应后、下一次整理时关上的问题'),
      example: v({ ...biggest, plain: { ask: PLAIN.loop.ask, response: PLAIN.loop.response } }, '让出份额最多的一次关闭：share 是关闭前后两帧这件的份额；plain 是入口页的白话（PLAIN.loop）'),
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
  .replace(/"(\[(?:[^"\\]|\\.)*\])"/g, (m, inner) => inner.replace(/\\"/g, '"'))}\n`;
if (process.argv.includes('--check')) {
  const committed = await readFile(file, 'utf8').catch(() => '');
  if (committed !== text) { console.error('site/landing/data.json 与回放现算的结果不一致；运行 node scripts/landing-data.mjs 重写'); process.exitCode = 1; } else console.log('data.json 与回放一致');
} else {
  await writeFile(file, text);
  console.log(`写入 ${path.relative(root, file)}：${data.frame.id.value} · ${data.beat1.n.value} 条 → 折掉 ${data.beat2.folded.value} · ${data.beat2.account.value.you} 份等你 · ${data.beat3.urgent.value.length} 件要紧`);
}
