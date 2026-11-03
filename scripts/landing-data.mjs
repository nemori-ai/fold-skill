// 入口页（site/landing/）上会出现的每个数，由演示回放现算，写成 site/landing/data.json。
// 只读原型的模块（variants/shared.mjs、variants/inflow.mjs 与它们引用的 scenario / engine），规则与原型同名函数一致，
// 不改原型、不改演示数据。数据集固定为 composite，帧固定为 f22（8/14 周五 00:00；2026-11-03 起从 f26 换来：这一刻开着的问题
// 都是日常的事，猫、母亲住哪、儿子的病假、女儿的同意书；/docs/why 用的也是 f22）。页面只读 data.json，不加载 2 MB 的回放。
//
//   node scripts/landing-data.mjs            # 重写 site/landing/data.json
//   node scripts/landing-data.mjs --check    # 只核对：现算结果与已提交的 data.json 不同就退出 1
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAME = 22;
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
// The urgent one the first screen's watch and the demo card show: of this moment's urgent asks, the one you really
// answered next (the loop's example), so the card and the real call that follows are one story; else the first by rank.
// At f22 that is the cat (Kajsa, 21:30: “Ring imorgon kl 8 prick”; the call went out 08:02). The watch prototype's own
// order puts the mother's (due today 23:59) first; both count in “2 件要紧”.
const leadItem = urgent.find(it => it.id === biggest.item) ?? urgent[0];
const lead = leadItem && currentAsk(s, leadItem.id);

// Items gone from the root this round. Merged into one still there: their share counts as that one's before (the
// ruler shows the merged item shrinking or growing, not a new one appearing). Withdrawn (done, past, no longer
// anyone's business): one group on the ruler that shrinks to nothing.
const snapItems = records[FRAME].snapshot.items;
const settle = id => { let at = id; for (let n = 0; snapItems[at]?.merged_into && n < 20; n += 1) at = snapItems[at].merged_into; return at; };
const nowIds = new Set(items.map(it => it.id));
const left = prevState.root.items.filter(it => !nowIds.has(it.id)).map(it => ({ id: it.id, share: it.share, status: snapItems[it.id]?.status ?? null, into: nowIds.has(settle(it.id)) ? settle(it.id) : null }));
const beforeOf = it => (prevShare.get(it.id) ?? 0) + sum(left.filter(l => l.into === it.id).map(l => l.share));
const withdrawn = left.filter(l => !l.into);

// ---------- 第 2 节：一个人一天的量级（示意，不是演示数据） ----------
// 第 2 节讲的是一般的问题，不用演示回放：一个普通人一天各个来源进来的条数。能找到公开统计的按统计取整（basis 写链接），
// 找不到的用保守的整数估计（basis 写“估计”，note 写怎么估的、参照了什么）。
// 每个群是一个单独的来源，Agent 每个都要读，所以群一个一行（kind 群聊）：一个人往往加了几十个群，这里按三十来个
// 活跃的群估计（不说话的群不算），每个一天几十到一百多条。人均加多少个群，没有找到可靠的公开统计。
// 行的顺序就是图里的顺序：先是群，再是其余来源，各自从多到少；最多的一项是群，所有群加起来远多于其余来源。
// 全部加起来至少是最多那一项的 15 倍：第 3 幕按总和换比例后，最长的单行不到整宽的 7%。逐笔行情、传感器读数不算。
// 出处表见 site/landing/story.md「第 2 节 · 为什么是新问题」。
const WTI = 'https://www.microsoft.com/en-us/worklab/work-trend-index/breaking-down-infinite-workday';
const WORK_GROUPS = `四个工作群（公司大群、部门群、两个项目群）合计 150 条，与微软 Work Trend Index 2025 统计的每个工作日 153 条 Teams 消息相当（${WTI}）`;
const DAY_SOURCES = [
  ['Discord 社区', '群聊', 150, '估计', '一个几千人的开源项目 Discord 服务器。参照：3,167 个公开服务器 2015–2024 年共 20.5 亿条消息（Discord Unveiled，https://arxiv.org/abs/2502.00627）；一个约千名活跃成员的开发者服务器平均每天约 100 条（Raglianti 等 2021，https://discordance.si.usi.ch/files/Raglianti2021a.pdf）'],
  ['业主群', '群聊', 150, '估计', '几百人的小区业主微信群（微信群上限 500 人）：报修、物业通知、闲聊'],
  ['小区团购群', '群聊', 150, '估计', '团长一天发几十个商品，邻居接龙下单'],
  ['行业交流群', '群聊', 120, '估计', '几百人的同行交流群'],
  ['炒股群', '群聊', 120, '估计', '开盘时间最热闹'],
  ['技术交流群', '群聊', 120, '估计', '几百人的技术群：提问、转发、讨论'],
  ['游戏 Discord', '群聊', 100, '估计', '一个游戏社区的 Discord 服务器'],
  ['家长群', '群聊', 100, '估计', '班级家长群：老师的通知、接龙、一串“收到”'],
  ['AI 工具 Discord', '群聊', 80, '估计', '一个 AI 工具的用户社区服务器'],
  ['大学同学群', '群聊', 80, '估计', '近况、聚会、转发'],
  ['小区闲置群', '群聊', 80, '估计', '二手转让、拼车、求助'],
  ['家族群', '群聊', 60, '估计', '转发的文章、节日问候、家里的事'],
  ['公司大群', '群聊', 60, '估计', `全员通知与闲聊。${WORK_GROUPS}`],
  ['跑步群', '群聊', 60, '估计', '打卡、约跑'],
  ['店铺福利群', '群聊', 60, '估计', '奶茶店、超市拉的群：优惠券、秒杀'],
  ['车友群', '群聊', 50, '估计', '同一款车的车主群'],
  ['部门群', '群聊', 40, '估计', `见公司大群：${WORK_GROUPS}`],
  ['前同事群', '群聊', 40, '估计', '上一家公司的同事'],
  ['校友会群', '群聊', 40, '估计', '同城校友：活动、招聘、转发'],
  ['项目群', '群聊', 30, '估计', `见公司大群：${WORK_GROUPS}`],
  ['兴趣班家长群', '群聊', 30, '估计', '孩子的游泳课、画画课'],
  ['高中同学群', '群聊', 30, '估计', '近况、聚会'],
  ['读书群', '群聊', 30, '估计', '打卡、讨论'],
  ['羽毛球群', '群聊', 30, '估计', '约场地、接龙'],
  ['养猫群', '群聊', 25, '估计', '猫粮团购、看病经验'],
  ['另一个项目群', '群聊', 20, '估计', `见公司大群：${WORK_GROUPS}`],
  ['同乡群', '群聊', 20, '估计', '老乡：转发、互助'],
  ['楼栋群', '群聊', 20, '估计', '同一栋楼的邻居：停水停电、快递放错'],
  ['旅行群', '群聊', 20, '估计', '一次出游临时拉的群'],
  ['健身群', '群聊', 20, '估计', '健身房的课程与打卡'],
  ['室友群', '群聊', 15, '估计', '大学室友'],
  ['公司兴趣群', '群聊', 15, '估计', '公司里的运动、读书小组'],
  ['工作邮件', '邮件', 120, WTI, '微软 Work Trend Index 2025：平均每天收到 117 封邮件，取整'],
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
// The one app the section points at (“← 一个软件”): the last row, so it is named at the bottom of the figure.
const ONE_APP = '幼儿园 App';
const dayTotal = sum(DAY_SOURCES.map(s => s.n));
{
  const isGroup = s => s.kind === '群聊';
  const groups = DAY_SOURCES.filter(isGroup), rest = DAY_SOURCES.filter(s => !isGroup(s));
  const desc = list => list.every((s, i) => !i || s.n <= list[i - 1].n);
  const widest = Math.max(...DAY_SOURCES.map(s => s.n)), groupSum = sum(groups.map(s => s.n));
  const problems = [
    DAY_SOURCES.some((s, i) => i && isGroup(s) && !isGroup(DAY_SOURCES[i - 1])) && 'why.day 要先列完所有的群，再列其余来源',
    !(desc(groups) && desc(rest)) && 'why.day 的群与其余来源各自要按条数从多到少排',
    DAY_SOURCES[0].n !== widest && '最多的一项不是群',
    groupSum < 2 * (dayTotal - groupSum) && `群加起来（${groupSum}）不到其余来源（${dayTotal - groupSum}）的两倍`,
    dayTotal < 15 * widest && `全部加起来（${dayTotal}）不到最多那一项（${widest}）的 15 倍：第 3 幕里每一行缩不到一点点`,
    DAY_SOURCES.at(-1).name !== ONE_APP && `why.day 的最后一行不是 ${ONE_APP}`,
    DAY_SOURCES.some(s => s.basis !== '估计' && !/^https:\/\//.test(s.basis)) && 'basis 只能是出处链接或“估计”',
    new Set(DAY_SOURCES.map(s => s.name)).size !== DAY_SOURCES.length && 'why.day 里有重名的行',
  ].filter(Boolean);
  if (problems.length) throw new Error(problems.join('；'));
}

// ---------- 首屏：一个程序员的一天（示意，和第 2 节同一天） ----------
// 用户 2026-11-03：“换成审批发版吧。。更程序员的例子，其他例子可以混合一点家常”。演示回放里没有“批准发版”这样的要紧
// 问题，所以首屏不再读回放，改成示意：第 2 节那一天的全部输入（同一份 DAY_SOURCES、同样的条数），按来源与时刻铺成
// 一片点；此刻是傍晚 6 点，场是此前 24 小时，一列一小时。每条输入在生成时就归到某一件事或哪件都不归，三扇窗亮的点
// 就是归到窗里那几件的。全部由固定的种子生成（mulberry32），没有随机抖动，每次构建结果一致；每项都带 basis “示意”。
// 第 4 节与原型展示仍是演示回放（f22），是真实数据。
const NOW_HOUR = 18;                       // 此刻：傍晚 6 点
const col = hour => (hour - NOW_HOUR + 24) % 24; // 第几列：0 是 24 小时前那一小时，23 是此刻之前那一小时
const H = (...spans) => { const w = Array(24).fill(0); for (const [from, to, x] of spans) for (let h = from; h < to; h += 1) w[h] += x; return w; };
// 一天里各类来源在每个钟点的相对多少（钟点 0–23）。
const PROFILES = {
  chat: H([0, 1, 2], [7, 9, 3], [9, 12, 4], [12, 14, 7], [14, 18, 4], [18, 20, 6], [20, 23, 9], [23, 24, 4]), // 群聊与私聊：午饭和晚上最热闹
  world: H([0, 24, 3], [9, 12, 2], [20, 24, 3]),                                       // Discord：各时区的人都在，半夜也有
  work: H([8, 9, 3], [9, 12, 10], [12, 14, 5], [14, 19, 10], [19, 22, 3], [22, 24, 1]), // 工作群、邮件、GitHub
  market: H([9, 12, 10], [13, 15, 10], [15, 16, 2]),                                   // 炒股群与自选股：开盘时间
  school: H([7, 9, 6], [11, 12, 2], [15, 18, 5], [20, 22, 3]),                         // 家长群、幼儿园 App
  news: H([6, 24, 2], [7, 9, 3], [12, 13, 3]),                                         // 新闻
  home: H([0, 24, 1], [7, 9, 4], [17, 23, 3]),                                         // 智能家居
  errand: H([9, 22, 2], [11, 13, 3], [17, 20, 3]),                                     // 购物外卖、快递、银行、短信、个人邮箱
  calendar: H([8, 10, 3], [13, 14, 2]),                                                // 日历
};
const PROFILE_OF = {
  'Discord 社区': 'world', '游戏 Discord': 'world', 'AI 工具 Discord': 'world',
  '公司大群': 'work', '部门群': 'work', '项目群': 'work', '另一个项目群': 'work', '工作邮件': 'work', 'GitHub 通知': 'work',
  '炒股群': 'market', '自选股': 'market', '家长群': 'school', '兴趣班家长群': 'school', '幼儿园 App': 'school',
  '新闻订阅': 'news', '智能家居': 'home', '购物外卖': 'errand', '快递': 'errand', '银行支付': 'errand', '短信': 'errand', '个人邮箱': 'errand',
  '日历': 'calendar',
};
for (const name of Object.keys(PROFILE_OF)) if (!DAY_SOURCES.some(x => x.name === name)) throw new Error(`首屏的钟点表里有 ${name}，DAY_SOURCES 里没有`);
const mulberry32 = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rng = mulberry32(20261103);
// n spread over 24 slots by weight, whole numbers that add up to n (largest remainder).
const spread = (n, w) => { const tot = sum(w), raw = w.map(x => n * x / tot), out = raw.map(Math.floor); const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]); const need = n - sum(out); for (let k = 0; k < need; k += 1) out[order[k][1]] += 1; return out; };
const inputs = DAY_SOURCES.flatMap((src, si) => spread(src.n, PROFILES[PROFILE_OF[src.name] || 'chat']).flatMap((k, hour) =>
  Array.from({ length: k }, () => ({ src: src.name, si, hour, c: col(hour), minute: Math.floor(rng() * 60), item: null }))));
inputs.sort((a, b) => a.c - b.c || a.minute - b.minute || a.si - b.si);
// 桌前那扇窗的十件事（份额加起来不到 64，余下是空余）：工作与家常混着，朱红只给等你回应的。一个连贯的傍晚：下午
// 上线的新版本让接口报错突增，要不要回滚得你来定（表盘上那一件，最大）；今晚的发版等你批准，但得等告警处理完。
// feed 是归到它的输入：[来源, 条数, 从几点, 到几点]（钟点；不写就是这 24 小时里任何时候），在符合的输入里均匀地挑。
const DESK = [
  { id: 'alert', name: '线上告警', turn: 'you', share: 16, urgent: true, ask: '下午上线的版本让接口报错突增，要不要回滚？', due: '半小时内',
    feed: [['工作邮件', 20, 15, 18], ['部门群', 6, 15, 18], ['项目群', 6, 15, 18], ['短信', 2, 15, 18]] },
  { id: 'release', name: '发版审批', turn: 'you', share: 10, ask: '今晚发版，等你批准（告警处理完再发）',
    feed: [['GitHub 通知', 12, 12, 18], ['项目群', 8], ['工作邮件', 6], ['另一个项目群', 4]] },
  { id: 'review-pay', name: '支付评审', turn: 'you', share: 7, ask: '支付那份改动，批准吗？', feed: [['GitHub 通知', 8], ['工作邮件', 3]] },
  { id: 'tests', name: '测试没过', turn: 'agent', share: 6, feed: [['GitHub 通知', 10], ['项目群', 4]] },
  { id: 'kid-leave', name: '孩子请假', turn: 'you', share: 5, ask: '孩子明天请假，回老师一句？', feed: [['幼儿园 App', 3], ['家长群', 6], ['私聊', 3]] },
  { id: 'review-login', name: '登录评审', turn: 'you', share: 4, ask: '登录那份改动，今天看还是明天？', feed: [['GitHub 通知', 5], ['工作邮件', 2]] },
  { id: 'cat', name: '猫的药', turn: 'agent', share: 4, feed: [['私聊', 3], ['养猫群', 3], ['购物外卖', 2]] },
  { id: 'dinner', name: '周末聚餐', turn: 'agent', share: 3, feed: [['大学同学群', 10], ['私聊', 3]] },
  { id: 'rent', name: '房租', turn: 'agent', share: 3, feed: [['银行支付', 2], ['短信', 2], ['私聊', 1]] },
  { id: 'parcel', name: '快递', turn: 'agent', share: 2, feed: [['快递', 5], ['短信', 2], ['购物外卖', 2]] },
];
// 今天早些时候办完的事：归到它们的输入只在复盘那扇窗里亮。
const DONE = [
  { id: 'standup', name: '站会改期', feed: [['日历', 2], ['部门群', 5], ['工作邮件', 3]] },
  { id: 'water', name: '小区停水', feed: [['业主群', 8], ['楼栋群', 5], ['智能家居', 2]] },
  { id: 'lunch', name: '午饭拼单', feed: [['店铺福利群', 4], ['购物外卖', 3]] },
];
for (const it of [...DESK, ...DONE]) for (const [src, k, from = NOW_HOUR, to = NOW_HOUR + 24] of it.feed) {
  const inHours = x => { const h = x.hour < NOW_HOUR ? x.hour + 24 : x.hour; return h >= (from < NOW_HOUR ? from + 24 : from) && h < (to <= NOW_HOUR ? to + 24 : to); };
  const pool = inputs.filter(x => x.src === src && !x.item && inHours(x));
  if (pool.length < k) throw new Error(`首屏：${it.name} 要从 ${src} 挑 ${k} 条，${from}–${to} 点只有 ${pool.length} 条`);
  for (let j = 0; j < k; j += 1) pool[Math.floor((j + 0.5) * pool.length / k)].item = it.id;
}
const WORK_ITEMS = new Set(['release', 'alert', 'review-pay', 'tests', 'review-login']);
const urgentDesk = DESK.filter(it => it.urgent);
const deskBlank = 64 - sum(DESK.map(it => it.share));
if (urgentDesk.length !== 1 || urgentDesk[0].turn !== 'you') throw new Error('首屏的表盘只给 1 件要紧，而且它等你回应');
if (deskBlank < 0) throw new Error('首屏桌前十件的份额超过了 64');
// 每条输入的档：0 哪件都不归 · 1 归到今天办完的事 · 2 归到 Agent 在办的 · 3 归到等你回应的 · 4 归到表盘上那一件。
const heroLevel = x => { const it = DESK.find(d => d.id === x.item); return !x.item ? 0 : !it ? 1 : it.urgent ? 4 : it.turn === 'you' ? 3 : 2; };
const heroField = Array.from({ length: 24 }, (_, c) => inputs.filter(x => x.c === c).map(heroLevel).join(''));
const heroLit = k => inputs.filter(x => heroLevel(x) >= k).length;
if (inputs.length !== dayTotal) throw new Error(`首屏的点（${inputs.length}）与第 2 节那一天（${dayTotal}）对不上`);
// 复盘那扇窗：这两周每天一根柱，当天收尾时注意力怎么分（64 份里工作、家常各占几份）。周末家常多；发版前三天
// 工作明显占大头；最后一根是今天，就是桌前那十件，告警那一大块朱红一眼看得出。小幅起伏也由同一个种子定。
const REVIEW_DAYS = 14;
const reviewRng = mulberry32(14);
const review = Array.from({ length: REVIEW_DAYS }, (_, k) => {
  const ago = REVIEW_DAYS - 1 - k, weekday = (5 - ago % 7 + 7) % 7; // 今天是周五（5）；0 周日、6 周六
  const ORDER = ['lead', 'you', 'work', 'home'];
  if (ago === 0) return [k, DESK.map(it => [it.share, it.turn === 'you' ? (it.urgent ? 'lead' : 'you') : WORK_ITEMS.has(it.id) ? 'work' : 'home']).sort((a, b) => ORDER.indexOf(a[1]) - ORDER.indexOf(b[1]))];
  const jig = () => Math.round((reviewRng() - 0.5) * 6);
  const [work, home] = weekday === 0 || weekday === 6 ? [10 + jig(), 30 + jig()] : ago <= 2 ? [46 + jig(), 10 + jig()] : [30 + jig(), 20 + jig()];
  return [k, [[work, 'work'], [home, 'home']]];
});
const ill = (value, source) => ({ value, source, basis: '示意' });

// ---------- 入口页的白话说法 ----------
// 用户 2026-11-03：“你要举例，举一点不拗口的，一眼就知道什么意思的。”入口页不直接搬演示原文（瑞典人名、#编号、PR、
// CI、瑞典语），每一件事、每个问题与选项、回流的例子都配一份白话，写进 data.json 的 plain 字段；原文留在旁边，页面只显示
// plain。人名换成角色：Jonas 是“你”，伴侣 Kajsa、女儿 Signe（11 岁）、儿子 Ture（4 岁）、母亲 Mamma、猫 Smilla。
// 白话要忠实于原件：是把原话翻成大白话，不是另编一件事。对照表见 site/landing/story.md「白话对照」。
const PLAIN = {
  // 每件事的短名：桌前那扇窗的格子、第 4 节尺下的“增 / 减”。6 个字以内。只写 f22 根层上的事。
  items: {
    'mamma-stambyte': '妈妈住哪',          // Mamma回执今天截止，昨晚已通话（楼里换水管那六周住哪）
    'smilla-vet': '猫的药',                // Smilla剂量疑超失明线，8点打诊所
    'pr-reviews-0814': '审同事的改动',     // #13572等你评审，另3个PR待审
    'ture-pickup-0812': '儿子请假',        // Ture好转37.6度，记得报vab
    'signe-school-start': '女儿签字',      // Signe 19日开学：签同意书、查头虱
    'signe-comic-talk': '女儿的漫画',      // Signe看的漫画有裸露图，12日谈
    'driveway-wet': '车道边潮湿',          // 邻居说车道信箱旁地面潮湿
    'ci-urls-master': '测试没通过',        // master仍红，13日合入后仍多平台失败
    'issue-13466': '一个补丁见效',         // #13466补丁有效，401疑为IIS冷启动
    'kajsa-bike-brake': '自行车刹车',      // Kajsa新车18日送到，你说后刹已修好
    'release-8-22-rc1': '新版快发布',      // 8.22.0-rc1已发，9月2日发布
  },
  // 每个开着的问题。
  asks: {
    'mamma-stambyte': '妈妈九月住哪？',            // 母亲九月住哪？
    'smilla-vet': '猫多吃了药，要打给兽医吗？',    // Smilla 多吃了药：打诊所？
    'pr-reviews-0814': '同事的修复，批准吗？',     // #13572 堵复用绕过：批准？
    'ture-pickup-0812': '照顾儿子的假，报了吗？',  // VAB 报了吗？（VAB：瑞典照顾生病孩子的带薪假）
    'signe-school-start': '女儿的同意书签了吗？',  // Signe 的同意书签了吗？
  },
  // 演示卡上的那一问：卡上的整句与两个选项（与原文的选项同序）。期限取条目的 due_at（8/14 08:00，标题“8点打诊所”；
  // Kajsa 21:30 “Ring imorgon kl 8 prick”）。
  lead: {
    item: 'smilla-vet',
    prompt: '怀疑给猫多喂了半片药，药量可能伤眼睛：早上 8 点打给兽医，还是先观察？', // 怀疑给 Smilla 多喂了半片恩诺沙星：打给诊所，还是先观察？
    actions: ['打给兽医', '先观察'], // 打给诊所 / 先观察
  },
  // 第 4 节尺下“减”那一行：本轮撤下的几件（办完、过期、不用再管）合成一组的名字。
  withdrawn: '不用再管的几件',
  // 回流里真实的那一次，接着演示卡那一问：Smilla 多吃了药：打诊所？→ 8/14 08:02 一通打给宠物诊所的电话
  // （Utgående samtal till Djurkliniken Kvarnbacken · 6 min），f23 读到。
  loop: { item: 'smilla-vet', ask: '猫多吃了药，要打给兽医吗？', response: '打给宠物诊所，6 分钟' },
};
const plainItem = id => { if (!PLAIN.items[id]) throw new Error(`白话缺 ${id}：在 PLAIN.items 里补一条`); return PLAIN.items[id]; };
const plainAsk = id => { if (!PLAIN.asks[id]) throw new Error(`白话缺问题 ${id}：在 PLAIN.asks 里补一条`); return PLAIN.asks[id]; };
// The lead question and the loop's example are written for one item each: a replay that changes them needs new words.
if (PLAIN.lead.item !== leadItem?.id || PLAIN.lead.actions.length !== (lead.actions || []).length) throw new Error(`白话的要紧一问写的是 ${PLAIN.lead.item}，回放里是 ${leadItem?.id}（${(lead.actions || []).map(a => a.label).join(' / ')}）`);
const leadDue = dueOf(leadItem, lead);
if (leadDue == null) throw new Error(`演示卡那一问（${leadItem.id}）没有期限，卡上的“要定”写不出来`);
if (PLAIN.loop.item !== biggest.item) throw new Error(`白话的回流例子写的是 ${PLAIN.loop.item}，回放里是 ${biggest.item}`);
// A deadline in words, read off the replay clock (both times carry the same offset): 早上 8 点前, 明天下午 3 点前,
// 今天之内 (23:59), 明天晚上前 (not on the hour).
const dueWords = (due, now) => {
  const days = Math.round((Date.parse(due.slice(0, 10)) - Date.parse(now.slice(0, 10))) / DAY);
  const hour = Number(due.slice(11, 13)), minute = Number(due.slice(14, 16));
  const day = ['', '明天', '后天'][days] ?? `${days} 天后`, part = hour < 12 ? '早上' : hour < 18 ? '下午' : '晚上';
  if (days >= 3) return `${days} 天内`;
  if (hour === 23 && minute === 59) return `${day || '今天'}之内`;
  return minute ? `${day || '今天'}${part}前` : `${day}${part} ${hour > 12 ? hour - 12 : hour} 点前`;
};

// A time on the replay clock, as the replay writes it (frames[].at carries the offset).
const localISO = t => new Date(t + Date.parse(frame.at.slice(0, 19) + 'Z') - Date.parse(frame.at)).toISOString().slice(0, 19) + frame.at.slice(19);
const minutes = t => Math.round((t - from) / 60000);
/** Where a tick lands: its item's index in beat2.segments, the item's id when it left the root this round, -1 when folded. */
const segmentOf = target => { if (!target) return -1; const i = items.findIndex(it => it.id === target); return i >= 0 ? i : target; };
const data = {
  about: '入口页上出现的每个数。由 scripts/landing-data.mjs 从演示回放现算（只读原型模块，规则与原型同名函数一致）；页面只读本文件，不加载回放。--check 核对本文件与回放一致。',
  dataset: v('composite', 'prototype/data/select.mjs defaultDataset；人物化名、输入为化名改写的真实公开数据，家庭流由作者编写（datasets.composite.notice）'),
  person: v(scenario.persona.name, 'scenario.persona.name'),
  frame: { id: v(frame.id, `scenario.frames[${FRAME}].id`), at: v(frame.at, 'frames[22].at'), title: v(frame.title, 'frames[22].title'),
    window: v([frame.signal?.window?.from || before.at, frame.signal?.window?.to || frame.at], 'frames[22].signal.window（缺省时取上一帧 at 到本帧 at），即“你离开的 12 小时”（8/13 中午到半夜）') },
  budget: v(state.root.budget, 'records[22].state.root.budget（prototype/engine.mjs BUDGET；每层 64 份，从不变）'),
  hero: {
    seen: ill(inputs.length, '首屏那片点的条数：第 2 节那一天（why.day）的全部输入，等于 why.total；示意，scripts/landing-data.mjs「首屏」'),
    now: ill(`${NOW_HOUR}:00`, '此刻：傍晚 6 点；场是此前 24 小时'),
    field: ill(heroField, '首屏那片点：此前 24 小时一小时一列（0 是 24 小时前那一小时），列里每条输入一位数字，按到达先后；每个来源按 why.day 的条数、按它那一类的钟点表铺开（PROFILES，最大余数取整），分钟由固定种子定；0 = 哪件都不归，1 = 归到今天办完的事，2 = 归到 Agent 在办的，3 = 归到等你回应的，4 = 归到表盘上那一件'),
    lit: ill({ used: heroLit(1), now: heroLit(2), you: heroLit(3), urgent: heroLit(4) }, 'field 里各档及以上的条数：复盘 / 桌前 / 等你 / 表盘亮着的点'),
    items: ill(DESK.map(it => ({ id: it.id, name: it.name, turn: it.turn, share: it.share, urgent: Boolean(it.urgent), ask: it.ask ?? null, inputs: inputs.filter(x => x.item === it.id).length })),
      '桌前那扇窗的十件事，按份额从大到小；name 是格子里的名字，turn 是等你（you）还是 Agent 在办（agent），inputs 是归到它的条数'),
    done: ill(DONE.map(it => ({ id: it.id, name: it.name, inputs: inputs.filter(x => x.item === it.id).length })), '今天早些时候办完的事：归到它们的输入只在复盘那扇窗里亮'),
    blank: ill(deskBlank, '64 − 十件的份额：桌前那扇窗里虚线的空余'),
    open: ill(DESK.filter(it => it.turn === 'you').length, '十件里等你回应的件数（朱红）'),
    urgent: ill(urgentDesk.length, '要紧的件数：表盘只给 1 件'),
    lead: ill({ item: urgentDesk[0].id, subject: '线上报错突增', question: '要不要回滚？', due: urgentDesk[0].due }, '表盘上那一件：线上告警（下午上线的版本让接口报错突增）；表盘上的两行字与期限'),
    review: ill(review, `复盘那扇窗：这两周每天一根柱 [第几天, [[份数, 类别]…]]，类别 work 工作 / home 家常；最后一根是今天，就是桌前那十件（you 等你、lead 表盘上那一件）；周末家常多，发版前三天工作占大头，起伏由固定种子定`),
  },
  why: {
    day: v(DAY_SOURCES, '第 2 节：一个人一天各个来源进来的条数，示意的量级，不是演示数据；先是群（kind 群聊，一个群一行），再是其余来源，各自从多到少，这也是图里行的顺序；basis 是出处链接或“估计”，note 写怎么得来（scripts/landing-data.mjs DAY_SOURCES）'),
    total: v(dayTotal, 'Σ why.day[].n：Agent 替这个人看着全部来源，一天要读的条数'),
    widest: v(DAY_SOURCES[0].n, 'why.day 里最多的一项：第 1 幕的比例按它定（它占满一行）'),
    oneApp: v(DAY_SOURCES.findIndex(s => s.name === ONE_APP), `标“← 一个软件”的那一行在 why.day 里的下标（${ONE_APP}）`),
  },
  beat1: {
    n: v(frame.events.length, 'frames[22].events.length；signal.received 同为 ' + frame.signal?.received),
    streams: v(streams, '按 frames[22].events[].stream 计数；车道顺序 work / community / life / family / subscription'),
    context: {
      twoWeeks: v(sum(frames.map(f => f.events.length)), 'Σ frames[].events.length（corpus 的 3217 条是 Σ signal.received，含未收进演示的条目）'),
      rounds: v(rounds.length, 'phase 不是 initial 的帧数'),
      perRound: v({ min: Math.min(...nPerRound), median: median(nPerRound), max: Math.max(...nPerRound) }, '各轮 events.length 的最小、中位、最大'),
    },
    ticks: v(plan.list.map(g => [minutes(g.at), frame.events[g.k].stream, to(g), segmentOf(g.target)]),
      '每条输入一项 [距窗口起点的分钟, stream, 去向 you|agent|fold, 落进的条目在 beat2.segments 里的下标；-1 = 没落进任何一件；字符串 = 落进了本轮离开根层的条目（见 beat2.gone）]；按时间排序；去向的规则同 variants/inflow.mjs inputsOf 与 variants/duo.mjs census'),
  },
  beat2: {
    adopted: v(census.you + census.agent, 'inputsOf(22).list 里 target 不为空的条数 = disposition used 的条数 ' + plan.counts.used),
    toYou: v(census.you, '落进等你回应那几件的输入；E 折叠屏左页“几条成了右页的几件”'),
    cardsFed: v(cardsFed, '本轮有输入落进的等你回应的件数'),
    toAgent: v(census.agent, '落进 Agent 那边条目的输入；E 折叠屏“进了 Agent 那边”的条数'),
    folded: v(census.fold, '没落进任何一件的输入；E 折叠屏折掉的条数'),
    foldedBy: v(foldedBy, 'folded 按 disposition 拆分（deferred 暂缓 / noise 噪音 / duplicate 重复）'),
    segments: v(items.map(it => { const due = dueOf(it, currentAsk(s, it.id)); return { id: it.id, title: it.title, plain: plainItem(it.id), turn: askIds.has(it.id) ? 'you' : 'agent', before: beforeOf(it), merged: left.filter(l => l.into === it.id).map(l => l.id), share: it.share, weight: it.weight, due: due == null ? null : new Date(due).toISOString() }; }),
      'records[22].state.root.items 按 rank；plain 是入口页上的白话短名（PLAIN.items）；before 是 records[21] 的份额（新出现的为 0）加上本轮并进它的条目在 records[21] 的份额（merged）；turn = 此刻是否有 currentAsk（variants/shared.mjs）；due 取问题的 due_at，没有时取条目的 due_at（forms/watch.mjs dueOf）'),
    gone: v(plan.list.filter(g => g.target && !items.some(it => it.id === g.target)).map(g => { const it = records[FRAME].snapshot.items[g.target]; return { id: g.target, title: it?.title ?? null, status: it?.status ?? null, mergedInto: it?.merged_into ?? null }; }),
      '本轮有输入归到、但在 f22 已不在根层的条目（records[22].snapshot.items）；E 折叠屏把这类输入也算进“Agent 那边”'),
    blank: v({ before: 64 - prevState.root.used, now: blank }, '64 − state.root.used，f21 与 f22'),
    withdrawn: v({ items: withdrawn.map(l => l.id), before: sum(withdrawn.map(l => l.share)), plain: PLAIN.withdrawn },
      '本轮从根层撤下（不是并进别处）的条目与它们在 f21 的份额之和：尺上合成一组，缩到没有；plain 是尺下的名字（PLAIN.withdrawn）'),
    account: v({ blank, agent: sum(agent.map(it => it.share)), agentItems: agent.length, you: sum(asks.map(it => it.share)), youItems: asks.length, used: state.root.used, items: items.length },
      '与 E 折叠屏份额带下的账同一算法（variants/duo.mjs shares）：空余 + Agent 那边 + 等你 = 64；used 是 state.root.used（原版树图的“已用”）'),
    yielded: v([...items.filter(it => beforeOf(it) !== it.share).map(it => ({ id: it.id, before: beforeOf(it), share: it.share, delta: it.share - beforeOf(it) })),
      ...(withdrawn.length ? [{ id: 'withdrawn', before: sum(withdrawn.map(l => l.share)), share: 0, delta: -sum(withdrawn.map(l => l.share)) }] : [])],
      '本轮份额变了的条目：f21 → f22 的份数与差（before 含并进来的条目）；id withdrawn 是撤下的那一组（beat2.withdrawn）'),
  },
  dueAhead: v(items.map(it => ({ id: it.id, due: dueOf(it, currentAsk(s, it.id)), you: askIds.has(it.id) })).filter(x => x.due != null && x.due > cursor).sort((a, b) => a.due - b.due)
    .map(x => ({ id: x.id, you: x.you, hours: Math.round((x.due - cursor) / 3600000) })), 'f22 此刻之后才到期的条目，按先后；hours 是距 frames[22].at 的小时数（B 时间展开的“此刻线之后”）'),
  beat3: {
    open: v(asks.length, 'f22 有 currentAsk 的根层条目数；D 手机首页“几件等你回应”'),
    fresh: v(life[FRAME].fresh.map(a => a.short), 'askLife：f22 开着而 f21 没开的问题；D 的“新问题”'),
    urgent: v(urgent.map(it => currentAsk(s, it.id).short), 'forms/watch.mjs isUrgent：24 小时内到期或档位 critical/high；腕上一瞥中间的数'),
    lead: v(lead && { item: leadItem.id, short: lead.short, prompt: lead.prompt, due: new Date(leadDue).toISOString(), actions: (lead.actions || []).map(a => a.label), share: leadItem.share, weight: leadItem.weight,
      inputs: plan.list.filter(g => g.target === leadItem.id).length,
      plain: { prompt: PLAIN.lead.prompt, actions: PLAIN.lead.actions, due: dueWords(localISO(leadDue), frame.at) } },
      '表盘与演示卡上的那一问：要紧的几件里，下一轮真的被回应的那一件（与 loop.example 同一件），没有时取 rank 最前的；frames[22].asks 里这一件的 short / prompt / due_at / actions；share 与 weight 取 state；inputs 是本轮归到它的条数；plain 是入口页的白话（PLAIN.lead，选项与 actions 同序；due 取问题的 due_at，没有时取条目的 due_at（forms/watch.mjs dueOf），plain.due 是它距 frames[22].at 的说法）'),
    asks: v(asks.map(it => { const a = currentAsk(s, it.id), due = dueOf(it, a); return { item: it.id, short: a.short, plain: plainAsk(it.id), name: plainItem(it.id), expects: a.expects, share: it.share, taps: taps(a), urgent: urgent.includes(it), due: due == null ? null : dueWords(localISO(due), frame.at) }; }),
      'f22 开着的问题，按 rank；plain 是白话（PLAIN.asks），name 是那件事的短名；taps 按 forms/trays.mjs 的规则；urgent 同 beat3.urgent；due 是期限的说法（问题的 due_at，没有时取条目的）'),
    taps: v(sum(asks.map(it => taps(currentAsk(s, it.id)))), '回应托盘“几下答完几个问题”'),
    loop: {
      responses: v(askEvents.length, '两周里带 feedback[].ask 的输入条数：你回应了一个登记的问题'),
      via: v(via, 'feedback[].via 的取值：全部是 source，即在原处回应，Agent 下一轮读到'),
      byChannel: v(askEvents.reduce((n, e) => { const k = String(e.channel || e.stream).split(' · ')[0]; return { ...n, [k]: (n[k] || 0) + 1 }; }, {}),
        '这些回应发生在哪里：event.channel 第一段（Telefon 是电话）'),
      asksRegistered: v(new Set(frames.flatMap(f => Object.values(f.asks || {}).map(a => a.id))).size, '两周登记过的不同问题数'),
      closedAfterResponse: v(closures.length, 'askLife.answered 累计：你回应后、下一次整理时关上的问题'),
      example: v({ ...biggest, plain: { ask: PLAIN.loop.ask, response: PLAIN.loop.response } }, '份额减少最多的一次关闭：share 是关闭前后两帧这件的份额；plain 是入口页的白话（PLAIN.loop）'),
    },
  },
  twoWeeks: {
    total: v(sum(frames.map(f => f.events.length)), 'Σ frames[].events.length'),
    used: v(disp.used, 'disposition === used 的条数'),
    byDisposition: v(disp, '按 event.disposition 计数'),
    roundsAtFull: v(records.filter((r, i) => i > 0 && r.state.root.used === r.state.root.budget).length, 'state.root.used === 64 的轮数；两周小倍数“几次用满 64 份”'),
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
