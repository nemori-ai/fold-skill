// An authored, fictional replay. Public facts are the only externally sourced material.
// Helpers expand the story into ordinary declarations; they do not judge importance.
const frames = [];
const stamp = (day, time) => `2026-10-${String(day).padStart(2, '0')}T${time}:00+08:00`;
const shanghaiTime = milliseconds => new Date(milliseconds + 8 * 60 * 60 * 1000).toISOString().slice(0, 19) + '+08:00';
const item = (id, title, summary, weight, kind, reason, sources, extra = {}) =>
  ({ id, title, summary, weight, kind, reason, sources, ...extra });
const update = (id, weight, kind, patch = {}) =>
  ({ id, relation: `supersedes:${id}`, weight, kind, ...patch });
const withdraw = (id, reason) => ({ id, relation: 'withdraw', reason });
function frame(day, time, title, chapter, narrative, messages, declarations, extra = {}) {
  const id = `f${String(frames.length + 1).padStart(2, '0')}`;
  const at = stamp(day, time);
  const batchTime = Date.parse(at);
  const messageWindow = frames.length ? 14 + (frames.length * 7) % 28 : 13;
  const previousTime = frames.length ? Date.parse(frames.at(-1).at) : batchTime - 60 * 60 * 1000;
  const messageStart = Math.max(batchTime - messageWindow * 60_000, previousTime + 60_000);
  const spanMinutes = Math.floor((batchTime - 60_000 - messageStart) / 60_000);
  const events = messages.map(([channel, from, text, disposition, why, relatedIds = [], publicSourceId], index) => ({
    id: `${id}-e${String(index + 1).padStart(2, '0')}`, channel, from,
    at: shanghaiTime(messageStart + Math.round(spanMinutes * Math.pow(index / Math.max(messages.length - 1, 1), 0.73)) * 60_000),
    text, disposition, why, relatedIds,
    ...(publicSourceId ? { publicSourceId } : {}),
  }));
  const sources = (...numbers) => numbers.map(number => {
    const e = events[number - 1];
    return { channel: e.channel, author: e.from, ref: `event:${e.id}`, quote: e.text, observed_at: at };
  });
  const changes = typeof declarations === 'function' ? declarations(sources) : declarations;
  const { acknowledges = [], ...frameExtra } = extra;
  frames.push({ id, at, title, chapter, narrative, events,
    batch: { batch_id: `shanghai-${id}`, actor: 'assistant', declarations: changes, acknowledges }, ...frameExtra });
}

frame(12, '09:10', 'v0.8拟周五向10%老用户开放', 'opening',
  '周五的小范围发布与远川试用最值得先看；家人的约定、费用与招聘各留一个位置。技术随手记先只留线索，不把每条未读都变成任务。', [
  ['团队群', '周屿 · 工程', '早。拾页 v0.8 想周五16点给老用户开 10%，今天得定哪些导出功能算这版。我下午带旧安卓机，租户开关也在准备，还没演练。', 'used', '本周需要林苒拍板的发布范围。', ['launch', 'performance']],
  ['客户邮件', '许宁 · 远川工作室', '两家门店愿意试一周。周五11点我们店长一起看一下，我今天找店长拿一份真实库存表发你。', 'used', '试用承诺有具体对象，但数据尚未到齐。', ['pilot']],
  ['监控', '体验采样机器人', '昨晚手机端筛选操作的 p75 INP 为 486ms，样本 43；桌面端 128ms。', 'used', '小样本提示风险，不能直接当成全量结论。', ['performance']],
  ['财务邮件', '陈澄 · 财务兼职', '上月模型 API 是 2,340 元，本月才过一半已到 2,910。周二18点前给我个预算吧。', 'used', '费用增长需要解释，暂未确认超支原因。', ['invoice-mail']],
  ['团队私信', '周屿 · 工程', '我这也收到一张云账单，金额 2,910，可能跟陈澄说的是同一张。', 'used', '身份未核实前暂分开保留，避免过早合并。', ['invoice-chat']],
  ['家人消息', '妈妈', '这周六你还陪我去东馆吗？上次你说忙完这一版就去。别又只发个链接给我啊。', 'used', '已答应过的相处时间，有连续的关系背景。', ['family']],
  ['招聘邮件', '苏禾 · 候选人', '周四晚上七点半能聊半小时。我主要想知道只有六个人，设计师进来会不会一直救火。', 'used', '候选人的顾虑关系到团队承诺，不只是约时间。', ['hiring']],
  ['资讯订阅', '前端周刊', '本周热门：27 个让你的 dashboard 看起来更高级的渐变背景。', 'noise', '与当前决策无关，不占板面。', []],
  ['个人随手记', '林苒', '上周读文档时记了一句：客户端取消了请求，服务端任务是不是还在跑？我们有空得查一下。', 'used', '低把握的旧线索先保留，不直接当作已证实的故障。', ['reading']],
], s => [
  item('launch', 'v0.8导出：模板编辑待定', '周五向老用户开放10%；今天先确定导出范围。', 'high', 'needs-you', '发布范围需要林苒决定。', s(1), { relation: 'supersedes:launch', due_at: stamp(16, '16:00'), children: [
    item('launch-scope', '导出模板是否允许编辑', '导出是否允许编辑模板，尚未定。', 'high', 'needs-you', '范围会影响两天的工程安排。', s(1)),
    item('launch-gate', '旧机操作验证与回滚演练', '手机筛选与回滚路径都需确认。', 'normal', 'in-progress', '保留发布条件。', s(1, 3), { children: [
      item('launch-smoke', '旧安卓机筛选与导出验证', '用门店旧安卓机走完筛选、导出。', 'normal', 'in-progress', '贴近试用场景。', s(1, 3)),
      item('launch-rollback', '租户级回滚开关尚未演练', '周屿准备租户级开关，尚未演练。', 'normal', 'in-progress', '小流量也需要能退回。', s(1)),
    ] }),
  ] }),
  item('pilot', '远川两店试用等待库存样表', '周五给两位店长看真实库存；样表还没收到。', 'high', 'in-progress', '试用能检验产品是否解决日常工作。', s(2), { due_at: stamp(16, '11:00'), children: [
    item('pilot-data', '远川库存样表尚未收到', '许宁答应发库存表，字段和权限未确认。', 'high', 'in-progress', '演示真实性取决于这份表。', s(2)),
    item('pilot-promise', '远川试用仅验证筛选后导出', '先验证筛选后导出，不先答应全店迁移。', 'normal', 'fyi', '把试用边界留在视线内。', s(2)),
  ] }),
  item('performance', '手机筛选INP 486ms，样本43', '小样本INP 486ms；先确认旧手机上的真实操作。', 'normal', 'in-progress', '有风险信号但影响范围还不清楚。', s(3), { children: [
    item('perf-sample', '手机INP样本仅43次', '43次手机访问，仅能提示方向。', 'normal', 'fyi', '避免把实验样本当作全量事实。', s(3)),
    item('perf-repro', '旧安卓机筛选问题待复现', '周屿下午带一台旧安卓机。', 'normal', 'in-progress', '需要复现才能定位。', s(1, 3)),
  ] }),
  item('invoice-mail', 'API费用2910元：预算待定', '财务要本月预算，暂未核对这笔费用。', 'normal', 'needs-you', '预算要有依据。', s(4), { due_at: stamp(13, '18:00') }),
  item('invoice-chat', '工程侧2910元账单待查重', '周屿收到同额账单，待核对是否重复。', 'low', 'fyi', '尚不能确认与财务邮件是否同一张。', s(5)),
  item('family', '周六陪妈妈去东馆，时段待定', '周六陪妈妈去东馆；时间还未最后定。', 'normal', 'needs-you', '保留已经作出的约定。', s(6), { relation: 'supersedes:family', children: [
    item('family-date', '陪妈妈的周六见面时间待定', '周六上午暂留给妈妈，不能只留一个口头答应。', 'high', 'needs-you', '安排尚未落实。', s(6)),
    item('family-route', '东馆开放时间与路线待核', '再核对开放时间与路程，不假定已经订好行程。', 'low', 'in-progress', '出门前需要确认。', s(6)),
  ] }),
  item('hiring', '苏禾面谈：需说清设计师职责', '周四晚聊半小时；需说清小团队的设计职责。', 'low', 'needs-you', '保留候选人提出的真实顾虑。', s(7), { due_at: stamp(15, '19:30') }),
  item('reading', '取消请求后后台是否仍运行', '上周随手记：取消客户端请求，不等于服务端工作已停止。', 'trace', 'fyi', '只是未验证的技术猜想，当前没有事故证据。', s(9)),
]);

frame(12, '13:40', '旧筛选结果覆盖新结果，旧安卓机已复现', 'opening',
  '旧手机上连续点筛选出现旧结果覆盖新结果，影响已经超过一个指标。提升性能问题，仍不把监控阈值直接当作业务重要性。', [
  ['团队群', '周屿 · 工程', '复现了：连点三个筛选，最后出来的是第二个结果。慢只是表象，我先查请求顺序。', 'used', '可复现的错误结果会误导用户。', ['performance', 'perf-repro']],
  ['官方资料', 'web.dev', 'INP 以实际交互响应衡量；p75 ≤200ms 为良好，>500ms 为差。实验与现场样本需区分。', 'used', '帮助解释数字，不能替代业务判断。', ['perf-sample'], 'inp'],
  ['监控', '体验采样机器人', '提醒：手机端 p75 INP 486ms，样本 43。', 'duplicate', '同一采样窗口再次通知，没有新证据。', ['performance']],
], s => [
  update('performance', 'high', 'in-progress', { title: '手机筛选：旧结果覆盖新结果', summary: '旧手机连点后旧结果覆盖新结果；周屿已复现。', reason: '正确性风险比初始性能信号更直接。', sources: s(1, 2) }),
  update('perf-repro', 'high', 'done', { title: '旧手机筛选结果覆盖已复现', summary: '已复现连续筛选结果串位，尚未修复。', reason: '复现完成不等于问题修复。', sources: s(1) }),
  update('perf-sample', 'normal', 'fyi', { summary: '官方标准供参照；当前43次采样仍不足以代表所有用户。', sources: s(2) }),
]);

frame(12, '20:30', '厨房渗水，物业尚未确定上门时间', 'opening',
  '先收下林苒对家人的批注，留给下一轮整理回应。家里渗水还未确认扩大，只留一个小入口；不把“师傅说应该行”写成预约成功。', [
  ['家人消息', '妈妈', '我今天先看了路线。你要是又有事，提前跟我说，我不想到了楼下才知道。', 'used', '补充这次约定的重要背景。', ['family']],
  ['物业私信', '物业小赵', '你家厨房墙脚照片我看到了。师傅说周四可能能上门，明天才确定。', 'used', '需要追踪但尚无扩大证据。', ['home']],
  ['团购群', '邻里拼单', '今晚牛油果最后一轮，满三盒免配送！', 'noise', '没有与用户当前事务相关的新信息。', []],
], s => [
  item('home', '厨房墙脚渗水，上门时段未定', '物业说周四可能上门；还没有确定时段。', 'low', 'in-progress', '先留线索，等待是否继续渗水与上门确认。', s(2), { children: [
    item('home-visit', '厨房维修上门时段待确认', '“周四可能”不是已约上；明天再确认。', 'normal', 'in-progress', '避免把承诺当作完成。', s(2)),
    item('home-photo', '厨房墙脚小片水渍，来源未明', '墙脚有一小块水渍，暂未确认来源。', 'low', 'fyi', '保留初始对照。', s(2)),
  ] }),
], { annotations: [{ id: 'ann-family-1', item: 'family', author: '林苒', text: '这不是普通周末待办。我已经放过妈妈两次鸽子，这次请帮我真正留住。', at: stamp(12, '20:30') }] });

frame(13, '09:20', '两条提醒来自同一张2910元API账单', 'opening',
  '两条账单线索核对为同一个账期、同一个编号，合成一个费用事项。回应林苒昨晚的批注，把家人的约定放大；东馆资料只用于计划，不声称已经出行。', [
  ['财务邮件', '陈澄 · 财务兼职', '核对好了，邮件和周屿截图都是 DEMO-1026，同一张。不要重复计入预算。', 'used', '身份确认后才可以合并。', ['invoice-mail', 'invoice-chat', 'expenses']],
  ['官方资料', '上海博物馆', '东馆在世纪大道1952号；常规10:00—18:00开放、17:00停止入场，周二闭馆，国定节假日除外。', 'used', '官方公开信息帮助安排周末，出发前仍可复核。', ['family-route'], 'museum-east'],
  ['团队群', '唐可 · 设计', '昨天水杯落会议桌的人记得拿，保洁阿姨帮忙洗了。', 'noise', '与当前整理的事项没有关联。', []],
], s => [
  item('expenses', 'API账单2910元，增量待核', '两条提醒来自同一张2910元账单；今天解释增量。', 'normal', 'needs-you', '账期与编号核对一致，合并避免重复占用注意力。', s(1), { relation: 'merges:[invoice-mail, invoice-chat]', due_at: stamp(13, '18:00') }),
  update('family', 'high', 'needs-you', { summary: '这次要兑现陪妈妈的约定；先锁住周六上午。', reason: '林苒说明此前两次失约，这次关系价值高于普通周末安排。', sources: s(2) }),
  update('family-route', 'normal', 'done', { title: '东馆时间、地址已核对', summary: '已查东馆常规时间与地址；周末出发前再核对。', reason: '公开信息已核对，出行尚未发生。', sources: s(2), stale_after: stamp(17, '08:00') }),
], { acknowledges: ['ann-family-1'] });

frame(13, '14:40', '远川两店库存口径不一，总库存暂不承诺', 'pressure',
  '客户真实库存按门店各用一套字段，周五承诺开始有风险。板面只剩64份：把已交给周屿推进的发布和可由财务先核查的费用缩小，给试用问题让位；家人的约定仍保留。', [
  ['客户邮件', '许宁 · 远川工作室', '表发了，A 店“可售”和 B 店“剩余”不是一个口径。能不能周五顺便合成总库存？', 'used', '真实数据揭示新约束，也出现扩展承诺。', ['pilot', 'pilot-data']],
  ['团队群', '林苒', '这版先不做模板编辑。周屿按固定模板推进，陈澄先核费用构成；总库存口径我来跟许宁确认，先别答应。', 'used', '用户明确范围取舍与分工。', ['launch', 'pilot-promise', 'expenses']],
  ['合作伙伴群', '渠道联系人', '我们也想试！能支持二十家门店和自动补货吗？下周就可以聊。', 'deferred', '当前两店试用尚未验证，不把新愿望升为本周承诺。', ['pilot']],
], s => [
  update('pilot', 'critical', 'needs-you', { title: '远川两店库存口径不一致', summary: '两店字段口径不同；今天需守住试用范围，别承诺总库存。', reason: '真实数据直接威胁已作出的周五承诺。', sources: s(1, 2) }),
  update('pilot-data', 'high', 'needs-you', { title: '远川两店库存字段口径待确认', summary: '表已收到；可售与剩余不同义，需许宁确认口径。', sources: s(1) }),
  update('pilot-promise', 'high', 'needs-you', { title: '远川新增总库存需求尚未答应', summary: '客户新提总库存；林苒尚未答应，先确认含义。', sources: s(1, 2) }),
  update('launch', 'normal', 'in-progress', { title: '导出发布已定固定模板', summary: '已定固定模板；周屿推进发布，暂不做模板编辑。', reason: '范围已有决定并交给工程，用户关注先转向客户承诺。', sources: s(2) }),
  update('launch-scope', 'normal', 'done', { title: '导出模板已定固定格式', summary: '范围已定：固定模板，暂不支持编辑。', reason: '范围决定完成，可降低即时关注。', sources: s(2) }),
  update('expenses', 'low', 'in-progress', { title: 'API费用构成核查中，预算待定', summary: '陈澄先核对费用构成；预算结论晚些再定。', reason: '先查构成，不在缺证据时挤占客户决策。', sources: s(2), due_at: stamp(14, '18:00') }),
]);

frame(13, '18:20', '筛选告警无新增证据，检查后状态不变', 'pressure',
  '重复告警与“在看了”没有带来新结论。这一轮只记一次检查：筛选问题仍重要，面积、摘要与业务更新时间保持原样。', [
  ['监控', '体验采样机器人', '再次提醒：旧安卓机筛选结果串位，事件 DEMO-174 仍打开。', 'duplicate', '与已知事件同一身份，没有新增影响。', ['performance']],
  ['团队群', '周屿 · 工程', '还在查，晚点给结论。现在不能说是网络问题。', 'used', '确认调查未完成，不把承诺写成修复。', ['performance']],
  ['团队私信', '唐可 · 设计', '我在群里又转了一遍那张串位截图，怕你漏了。', 'duplicate', '同一截图已被纳入，不新增板块。', ['performance']],
], [update('performance', 'high', 'in-progress')]);

frame(14, '09:10', '取消导出后后台仍计算，暂停新增租户', 'pressure',
  '工程发现取消客户端请求后后台仍在计算，费用与串位有了交点。把随手记从一条痕迹提升为调查入口；同时缩小已委派的招聘与账单，所有取舍都留下理由。', [
  ['团队群', '周屿 · 工程', '日志对上了：前端 abort 以后，导出任务还在后台跑。用户连点会排三份。先别开新租户。', 'used', '新证据把性能、正确性与费用关联起来。', ['performance', 'reading', 'expenses']],
  ['官方资料', 'MDN', 'AbortController.abort() 可以中止 fetch、响应体读取和流；这段接口说明本身不保证应用服务器会取消业务任务。', 'used', '前半是官方能力，后半是对文档边界的解释。', ['reading'], 'abort-controller'],
  ['用户消息', '林苒', '我已把“两店分别导出，先不合并总库存”的方案发给许宁，等她确认。', 'used', '方案已提出，但对方尚未接受。', ['pilot', 'pilot-promise']],
], s => [
  update('performance', 'critical', 'in-progress', { title: '筛选故障已查到后台重复任务', summary: '连点触发重复后台任务；先暂停新增租户，查取消链路。', reason: '真实重复计算同时影响正确性和成本。', sources: s(1) }),
  update('reading', 'normal', 'in-progress', { title: '取消链路：后台未停，幂等待查', summary: '早先的随手记与日志吻合；需检查服务端取消与幂等。', reason: '新日志让低权重线索成为排查入口，尚未证明修法。', sources: s(1, 2) }),
  update('pilot', 'high', 'in-progress', { title: '远川分店导出方案待客户确认', summary: '已提出两店分别导出方案；等许宁确认与工程恢复。', reason: '已有范围收缩方案，当前等待客户与工程回应。', sources: s(3) }),
  update('pilot-promise', 'normal', 'in-progress', { title: '分店导出方案待客户确认', summary: '拟先做两店分别导出，不合并总库存；客户尚未确认。', reason: '方案已提出，等待反馈，不把建议写成承诺落地。', sources: s(3) }),
  update('launch', 'low', 'in-progress', { title: '导出发布暂停新增租户', summary: '发布暂停开新租户；周屿先处理重复任务。', reason: '当前首要是恢复正确性，发布计划缩小等待。', sources: s(1) }),
  update('expenses', 'trace', 'in-progress', { title: 'API费用拆分待核，疑有重复任务', summary: '已发现重复后台任务线索；财务等工程给费用拆分。', reason: '费用调查已转到工程故障，此处保留财务交接。', sources: s(1) }),
  update('hiring', 'trace', 'needs-you', { reason: '本轮关注集中在故障，招聘时间未取消，但尚无需新决定。' }),
]);

frame(14, '18:10', '旧结果覆盖新结果已修复，后台重复计算待修', 'pressure',
  '串位已修，后台重复任务还没堵住。性能降到高关注，但不标记完成；让发布恢复一点空间。技术阅读暂缩小，留下“只验证了一半”的边界。', [
  ['团队群', '周屿 · 工程', '请求序号校验上了，旧结果不会覆盖新结果。服务端幂等还没上，今晚不硬赶。', 'used', '一个症状修复，根因链路并未全部闭合。', ['performance', 'reading']],
  ['客户邮件', '许宁 · 远川工作室', '分店看可以，先别求一个总数。周五 11 点我能在，另一位店长可能迟十分钟。', 'used', '客户接受缩小范围，时间仍有小幅不确定。', ['pilot']],
  ['团队群', '唐可 · 设计', '更新一张空状态插画。等这次上线稳了再看看，不急。', 'deferred', '作者明确不急，且当前不阻塞试用。', ['launch']],
], s => [
  update('performance', 'high', 'in-progress', { title: '筛选错误已修，后台重复计算待修', summary: '旧结果覆盖已修；服务端仍可能重复计算，尚未收尾。', reason: '直接错误已堵住，但成本风险仍在。', sources: s(1) }),
  update('perf-repro', 'high', 'done', { title: '旧机筛选错误已修复', summary: '旧机串位已修；服务端重复计算另由周屿处理。', sources: s(1) }),
  update('reading', 'low', 'fyi', { title: '取消链路：服务端幂等仍未完成', summary: '请求序号防串位；服务端幂等仍需单独处理。', reason: '修法已进入工程工作，此处只保留技术边界。', sources: s(1) }),
  update('launch', 'normal', 'in-progress', { title: '导出发布等待幂等验证', summary: '固定模板可继续准备；新租户仍等幂等验证。', reason: '工程已拆开问题，发布准备可以恢复。', sources: s(1) }),
  update('pilot', 'high', 'in-progress', { title: '远川已确认周五演示分店库存', summary: '周五11点看分店库存；一位店长可能稍晚到。', sources: s(2) }),
  update('pilot-promise', 'normal', 'done', { title: '远川已确认分店导出范围', summary: '许宁已接受两店分别导出，不合并总库存。', reason: '客户实际确认了收缩后的试用边界。', sources: s(2) }),
]);

frame(15, '09:40', '厨房渗水扩大，上门落空需另定安排', 'pressure',
  '家里出现明确的新损害证据，提升维修事项。不是因为周四到了才自动加权，而是水渍扩大且物业仍无确定上门时间。', [
  ['用户消息', '林苒', '早上水渍比昨天大了一圈，橱柜底板也有点湿。我要去客户那儿，不能一直在家等。', 'used', '损害扩大并与工作安排冲突。', ['home', 'home-photo']],
  ['物业私信', '物业小赵', '师傅上一家还没结束，今天上午来不了了，我争取下午给你准信。', 'used', '之前的可能上门并没有兑现。', ['home-visit']],
  ['快递通知', '驿站机器人', '您的纸巾已到驿站，取件码为演示编号 A-001。', 'noise', '普通包裹不改变当前取舍。', []],
], s => [
  update('home', 'high', 'needs-you', { title: '厨房渗水扩大，上门时段未定', summary: '渗水扩大且上午上门落空；需要确定替代到场安排。', reason: '新照片显示损害扩大，林苒又无法长时间在家。', sources: s(1, 2) }),
  update('home-photo', 'high', 'fyi', { title: '厨房水渍扩大，柜底板也变湿', summary: '水渍扩大，底板变湿；已有今早照片可对比。', sources: s(1) }),
  update('home-visit', 'high', 'needs-you', { title: '厨房维修上午未到，时间待确认', summary: '上午上门落空；物业只承诺下午给准信。', sources: s(2), due_at: stamp(15, '16:00') }),
]);

frame(15, '14:30', '苏禾约谈推至下周，新时间尚待确认', 'pressure',
  '苏禾主动把沟通延后一周，技术随手记也已有明确工程归属。撤下它们让板面安静一些，旧内容和原因仍在历史里；家人与维修不因工作很忙被挤掉。', [
  ['招聘邮件', '苏禾 · 候选人', '抱歉，我这周项目收尾，今晚聊不了了。下周一我再给你新的时间。', 'used', '对方明确推迟，不必保留本周行动入口。', ['hiring']],
  ['团队群', '周屿 · 工程', '取消链路那条笔记我放进事故文档了，幂等我负责，不用你继续盯阅读链接。', 'used', '线索有了明确接手者，可以退出当前展示。', ['reading']],
  ['招聘平台', '职位周报', '本周有 18 位候选人浏览了你发布的职位。', 'noise', '曝光统计不改变这次候选人沟通。', ['hiring']],
], [
  withdraw('hiring', '苏禾主动改期到下周再约，本周没有待决定内容；保留旧记录。'),
  withdraw('reading', '取消链路已进入周屿负责的事故文档，暂不另占阅读入口。'),
]);

frame(15, '21:00', 'v0.8待验证：旧安卓机测试未完成', 'pressure',
  '明天试用仍需条件检查。恢复发布关注是因为林苒需要决定是否继续，不把工程的预计完成时间当成测试通过。', [
  ['团队群', '周屿 · 工程', '幂等写好了，还没跑完旧安卓机那组。估计明早能好，今晚我先回去。', 'used', '有实现进展，也明确保留验证缺口。', ['launch', 'performance']],
  ['家人消息', '妈妈', '周六我上午先办点事，十一点在你家楼下行不行？我们慢慢吃个饭再去。', 'used', '约定变成具体安排，与工作截止分开。', ['family']],
  ['用户消息', '林苒', '十一点好，周六我在楼下等你。先吃饭，慢慢去，不赶场。', 'used', '林苒明确接受妈妈提出的时间。', ['family']],
], s => [
  update('launch', 'high', 'needs-you', { title: '导出发布前旧机验证未完成', summary: '幂等已写但旧机未测；明早需据验证决定是否开放。', reason: '需要林苒做有条件的发布决定，不能沿用乐观预计。', sources: s(1) }),
  update('launch-smoke', 'high', 'in-progress', { title: '旧机验证未完成，幂等已实现', summary: '幂等已实现；旧安卓机验证仍未完成。', sources: s(1) }),
  update('family', 'high', 'needs-you', { title: '周六11点见妈妈，再去东馆', summary: '周六11点妈妈到楼下；先吃饭，再一起去东馆。', sources: s(2, 3), due_at: stamp(17, '11:00') }),
  update('family-date', 'high', 'done', { title: '已约妈妈周六11点楼下见', summary: '已约周六11点楼下见；这只是约好，还未成行。', sources: s(2, 3) }),
]);

frame(16, '10:00', '试用演示前，暂存列口径仍未明确', 'pressure',
  '工程证据已能支持小范围试用，性能缩小。客户样表仍缺一个字段解释，给马上要作出的承诺最大注意力；维修已确认由邻居代开门，降低用户即时负担。', [
  ['团队群', '周屿 · 工程', '旧机验证过了：连点只生成一个任务，回滚也演练了。先给远川两家开，别同时给老用户开。', 'used', '有验证与范围明确的建议。', ['launch', 'performance']],
  ['客户邮件', '许宁 · 远川工作室', '“暂存”这一列等店长来了再解释，先别从可售里直接扣。我 11 点准时。', 'used', '缺口直接影响演示时呈现的数字。', ['pilot']],
  ['物业私信', '物业小赵', '下午两点师傅能到，隔壁邻居说可以帮你开门；我等会再发师傅电话。', 'used', '代开门落实了，但维修还没有发生。', ['home']],
], s => [
  update('pilot', 'critical', 'needs-you', { title: '远川演示仍缺暂存字段解释', summary: '11点演示只看分店数据；暂存口径未知，不能算进可售。', reason: '演示即将作出用户可见判断，错误口径不能被界面掩盖。', sources: s(2) }),
  update('pilot-data', 'high', 'needs-you', { title: '远川暂存列含义尚未确认', summary: '还缺暂存列含义；演示中明确留空，等店长解释。', sources: s(2) }),
  update('performance', 'normal', 'in-progress', { title: '筛选与幂等已验证，观察两店', summary: '旧机连点与回滚验证通过；继续观察两店使用。', reason: '验证通过且范围受控，转入观察而非宣称永久解决。', sources: s(1) }),
  update('perf-repro', 'normal', 'done', { title: '旧机筛选与幂等验证通过', summary: '旧机筛选与幂等验证通过，进入真实使用观察。', reason: '复现与本轮验证已完成，保留结果。', sources: s(1) }),
  update('launch', 'high', 'needs-you', { title: '导出发布是否仅开放远川两店', summary: '旧机与回滚已验证；是否只向远川两店开放待决定。', reason: '工程条件已通过，但开放范围仍待林苒决定。', sources: s(1) }),
  update('launch-smoke', 'normal', 'done', { title: '旧机筛选与导出验证通过', summary: '旧机筛选与导出已通过这轮验证。', reason: '验证完成，保留结果。', sources: s(1) }),
  update('launch-rollback', 'normal', 'done', { title: '租户级回滚开关已演练', summary: '租户级回滚已演练。', sources: s(1) }),
  update('home', 'normal', 'in-progress', { title: '厨房维修已约周五14点', summary: '下午两点维修，邻居代开门；等实际检查结果。', reason: '到场与代开门已确认，用户暂不必现场处理。', sources: s(3) }),
  update('home-visit', 'normal', 'in-progress', { title: '厨房上门已约，邻居代开门', summary: '周五14点已约师傅，邻居代开门；尚未实际到场。', reason: '上门与代开门已确认，等待执行。', sources: s(3), due_at: stamp(16, '14:00') }),
]);

frame(16, '17:40', '远川两店已开通，暂存口径仍待补充', 'pressure',
  '试用演示已经发生，两店开通成功。完成的成果继续保留，方便林苒确认这一周做成了什么；同时把“暂存口径仍待补充”留在父层摘要，避免绿色状态抹掉遗留。', [
  ['客户邮件', '许宁 · 远川工作室', '下午店长都试到了，导出比原来少复制两遍。“暂存”先按你说的单独显示，我周一补口径。', 'used', '真实使用反馈与未兑现的信息承诺并存。', ['pilot']],
  ['部署记录', '周屿 · 工程', '16:35 仅远川两个演示租户已启用 v0.8；没有给其他用户打开。', 'used', '已经完成的动作有明确范围。', ['launch']],
  ['监控', '体验采样机器人', '提醒：DEMO-174 事件仍未手动关闭。', 'duplicate', '状态提醒不代表再次发生故障。', ['performance']],
], s => [
  update('launch', 'high', 'done', { title: '导出v0.8仅远川两店已开放', summary: '远川两店已开通v0.8；其他老用户仍未开放。', reason: '小范围上线已完成，成果需要留下供确认。', sources: s(2) }),
  update('launch-gate', 'normal', 'done', { title: '旧机验证与回滚演练均通过', summary: '旧机验证与回滚演练均通过，本次只开两店。', sources: s(2) }),
  update('pilot', 'critical', 'done', { title: '远川两店已试用，暂存口径待补', summary: '两店演示完成并开始试用；暂存口径仍等周一补充。', reason: '承诺的演示已完成，保留高关注让用户确认结果与遗留。', sources: s(1) }),
]);

frame(16, '21:20', '用户要求周末优先陪妈妈，关注调整待回应', 'weekend',
  '收下林苒的反馈：她认可今天的成果，但不想周末继续被发布占满。此帧先保存批注，下一轮才按反馈调整；用户的话与Agent的决定分别可查。', [
  ['用户消息', '林苒', '今天终于成了。我想明天把手机收起来，别让那个大大的发布块一直像没做完一样。', 'used', '用户在改变关注偏好，而不是否认成果。', ['launch', 'family']],
  ['家人消息', '妈妈', '我周六办事那边临时改到下午，要不我们周日？你别为了我明天一直等。', 'used', '家庭安排确实变化，需重新落实。', ['family']],
  ['团队群', '唐可 · 设计', '收到，周末不聊工作。发个猫。', 'noise', '社交回应不生成工作事项。', []],
], [], { annotations: [{ id: 'ann-weekend', item: 'family', author: '林苒', text: '改到周日也可以。这次保留最大的位置给妈妈；发布做成了就让它小一点，但别删掉。', at: stamp(16, '21:20') }] });

frame(17, '10:00', '陪妈妈改约周日11点，双方已确认', 'weekend',
  '回应昨晚批注：家人的约定成为本周末最重要的一块，发布与演示成果缩小但留在眼前。新的见面时间有双方确认；场馆信息过了复核时间，保留原值等待人工重查。', [
  ['用户消息', '林苒', '我和妈妈说好了，周日十一点见。今天先在家等维修消息，晚上不加班。', 'used', '用户明确新的安排与注意力偏好。', ['family', 'home']],
  ['团队群', '周屿 · 工程', '两店昨晚没新报错。我只留值班监控，周一再看体验样本。', 'used', '当前可由同事观察，无需用户持续盯守。', ['launch', 'performance']],
  ['日历提醒', '本地日历', '11:00 和妈妈见面（旧时间）。', 'duplicate', '旧安排已被新的双方确认覆盖，保留原流解释变化。', ['family']],
], s => [
  update('family', 'critical', 'needs-you', { title: '陪妈妈去东馆改到周日11点', summary: '改到周日11点见；这个周末先兑现陪妈妈的约定。', reason: '回应林苒的明确反馈，关系承诺是本周末首要关注。', sources: s(1), due_at: stamp(18, '11:00') }),
  update('family-date', 'high', 'done', { title: '已改约妈妈周日11点见', summary: '双方已确认周日11点见，旧周六安排取消。', sources: s(1) }),
  update('launch', 'low', 'done', { summary: '两店小发布已完成；周末由周屿观察，周一再复盘。', reason: '林苒已确认成果并希望腾出周末注意力，保留而不删除。', sources: s(2) }),
  update('pilot', 'normal', 'done', { summary: '首轮演示已完成；周一再补暂存口径和试用反馈。', reason: '用户已看到结果，后续需要等客户补材料。', sources: s(2), due_at: stamp(19, '12:00') }),
]);
frames[14].batch.acknowledges = ['ann-weekend'];

frame(17, '21:30', '厨房换接头后再渗水，回访开门人待定', 'weekend',
  '物业下午的“处理好了”被晚上的新照片修正。重新提升维修，不沿用完成承诺；家人的计划仍然保留，安排由别人协助并不降低它对林苒的意义。', [
  ['物业私信', '物业小赵', '昨天临时没来成，今天下午才换了接头，师傅说处理好了。但你新照片看着还有水，我明早让他回来看。', 'used', '上门曾落空，实际维修后的新照片也推翻了乐观结论。', ['home']],
  ['用户消息', '林苒', '我在下面垫了毛巾，没流到电器那边。明早能不能请邻居再帮一下？我不想又取消和妈妈出门。', 'used', '当前损害与替代安排都有明确边界。', ['home', 'family']],
  ['促销短信', '家居卖场', '双十家装提前购，收纳柜全场特价。', 'noise', '促销与现有渗水问题无实际关联。', []],
], s => [
  update('home', 'high', 'needs-you', { title: '厨房换接头后仍渗水，需回访', summary: '换接头后又见水；明早要回访，需确定谁来开门。', reason: '新照片显示维修未解决问题，并可能冲突于已约好的出行。', sources: s(1, 2) }),
  update('home-visit', 'high', 'needs-you', { title: '厨房回访待邻居确认代开门', summary: '物业承诺明早回访；邻居是否代开门待确认。', sources: s(1, 2), due_at: stamp(18, '09:00') }),
]);

frame(18, '08:00', '维修与出行无新输入，检查后状态不变', 'weekend',
  '没有新输入。日历往前走了，维修与出行都更近，场馆资料也显示待复核；这些时间变化本身不改写重要性、摘要或业务更新时间。', [], []);

frame(18, '17:20', '陪妈妈参观东馆已完成，厨房返修后待观察', 'weekend',
  '保留这次兑现的家庭约定作为完成成果。家里找到第二处松动接头，先观察到明天；不因为今天修了两次就把它直接宣布结束。', [
  ['用户消息', '林苒', '今天去了。妈妈在陶瓷那边待了很久，出门还说“你小时候也是看什么都慢”。挺好的。', 'used', '用户确认约定实际兑现，值得留下。', ['family']],
  ['物业私信', '物业小赵', '邻居帮开门了，发现另一个接头松了，已经重新固定。今晚再看，明早给我张照片。', 'used', '有实际维修记录，但仍需观察。', ['home']],
  ['家人消息', '妈妈', '照片我发家里群啦。下回不用安排那么多，吃个饭也好。', 'used', '这次相处带来新的偏好，不等同于新任务。', ['family']],
], s => [
  update('family', 'critical', 'done', { title: '已陪妈妈逛东馆', summary: '今天陪妈妈去了东馆；这次约定真正兑现了。', reason: '用户明确确认完成，保留关系成果而非马上抹去。', sources: s(1, 3) }),
  update('family-date', 'high', 'done', { title: '已与妈妈见面参观东馆', summary: '周日已见面并同行参观。', sources: s(1) }),
  update('family-route', 'low', 'done', { title: '东馆行程结束，路线留档', summary: '本次出行已结束，旧路线资料不再影响行动。', reason: '行程完成，路线只是留存资料。', sources: s(1), stale_after: null }),
  update('home', 'high', 'in-progress', { title: '厨房第二处接头已修，待观察', summary: '第二处接头已固定；今晚观察，明早补照片。', sources: s(2) }),
  update('home-photo', 'normal', 'in-progress', { title: '厨房修后照片待补，对比渗水', summary: '两次渗水照片已保存；等今晚维修后的照片做对比。', reason: '故障点已处理，关注从损害扩大转为结果验证。', sources: s(2) }),
  update('home-visit', 'normal', 'done', { title: '邻居已开门，厨房回访维修完成', summary: '邻居代开门，第二次维修已发生；观察仍未结束。', reason: '到场任务已完成，关注转到维修结果。', sources: s(2) }),
]);

frame(19, '09:10', '暂存口径再次延期，扩大演示范围待决定', 'second-week',
  '周末成果缩小保留，注意力回到试用与后续发布。苏禾发来新时间，撤下的招聘按原ID回来；费用线索让技术笔记也复归，过去的资料不用重新发明。', [
  ['客户邮件', '许宁 · 远川工作室', '周末试了六次，导出顺了。但“暂存”我还没问到老店长，今天下班前给你。另想周三给其他同事演示。', 'used', '试用有进展，也有再次延期的口径承诺。', ['pilot', 'launch']],
  ['招聘邮件', '苏禾 · 候选人', '这周四晚七点半可以了。上次那个“是否一直救火”，我还是很想先听实话。', 'used', '明确新安排，使原事项重新相关。', ['hiring']],
  ['团队私信', '陈澄 · 财务兼职', '费用拆分还差一点，周屿给的日志里周末也有重复任务。我把你那条取消笔记翻出来了。', 'used', '新证据让已撤下线索再次有用。', ['expenses', 'reading']],
], s => [
  update('family', 'normal', 'done', { summary: '陪妈妈去东馆已完成；她说下次简单吃饭也好。', reason: '林苒已享受并确认成果，工作周开始保留小块纪念。' }),
  update('pilot', 'high', 'in-progress', { title: '远川试用暂存口径再次延期', summary: '两店试用继续；暂存口径又延期，周三同事演示待定。', reason: '客户新反馈带来新的承诺边界。', sources: s(1), due_at: stamp(19, '18:00') }),
  update('launch', 'high', 'needs-you', { title: '导出发布是否扩大开放', summary: '客户想周三扩大演示；是否扩大开放仍需判断。', reason: '新增范围需要负责人决策，不延续上周默认。', sources: s(1), due_at: stamp(21, '10:00') }),
  update('hiring', 'low', 'needs-you', { title: '苏禾改约周四晚，设计职责待谈', summary: '苏禾改约周四19:30，仍想听清设计师职责。', reason: '候选人给出新时间，原事项恢复相关性。', sources: s(2), due_at: stamp(22, '19:30') }),
  update('reading', 'low', 'in-progress', { title: '取消链路：周末仍有重复任务', summary: '周末日志仍有重复任务；重新查取消与幂等边界。', reason: '新日志使已撤下的线索再次有调查价值。', sources: s(3) }),
]);

frame(19, '15:30', 'API费用预测6400元，本月上限待定', 'second-week',
  '费用拆分显示重试、正常增长与测试环境混在一起，不能把所有增量都归给同一个bug。提升预算决定，发布与招聘暂缩小，但继续保留责任与时间。', [
  ['财务邮件', '陈澄 · 财务兼职', '模拟账单拆好了：本月预测 6,400。约 1,100 是测试环境，900 是重复任务，其余是使用量。要不要先定 5,000 的目标？', 'used', '预算需要在多种原因间作真实取舍。', ['expenses']],
  ['团队群', '林苒', '先别买年付。周屿关掉闲置测试环境，我来跟陈澄确认本月上限；周三不承诺全量。', 'used', '用户明确成本行动与发布边界。', ['expenses', 'launch']],
  ['供应商邮件', '模型服务商营销', '年付立减20%，今日咨询还可领取企业专属方案。', 'deferred', '折扣不能替代用量核对，用户已明确先不年付。', ['expenses']],
], s => [
  update('expenses', 'high', 'needs-you', { title: 'API月费预测6400元，上限待定', summary: '预测6400元：测试、重复任务与用量增长并存；要定本月上限。', reason: '有了可决策的拆分，预算不能继续只等工程修复。', sources: s(1, 2), due_at: stamp(20, '16:00'), children: [
    item('cost-breakdown', '测试约1100元、重复任务约900元', '约1100元测试、900元重复，其余为正常使用；均为演示数据。', 'high', 'fyi', '解释不能全部归因于bug。', s(1)),
    item('cost-limit', '建议预算5000元，尚未批准', '5000元是财务建议，还未批准。', 'high', 'needs-you', '建议与已批准金额必须区分。', s(1, 2)),
    item('cost-test', '闲置测试环境关闭待回执', '林苒要求周屿关闭，尚无执行回执。', 'normal', 'in-progress', '指令不等于完成。', s(2)),
  ] }),
  update('launch', 'normal', 'in-progress', { title: '导出发布暂不承诺全量开放', summary: '周三只考虑客户演示，暂不承诺全量开放。', reason: '用户已明确范围边界，预算决定先行。', sources: s(2) }),
  update('hiring', 'trace', 'needs-you', { reason: '约见时间已明确，当前等待周四，先给预算决定腾出注意力。' }),
]);

frame(19, '20:50', '厨房隔夜未再渗水，物业已确认结单', 'second-week',
  '维修结果得到隔夜照片确认，可以完成并缩小。保留小块是为了记住已经查过、修过什么，而不是让“done”自动退出视野。', [
  ['用户消息', '林苒', '今晚墙脚是干的，底板也没再湿。我把前后照片都发给物业了。', 'used', '来自现场的新证据支持完成判断。', ['home']],
  ['物业私信', '物业小赵', '收到照片，这次先结单。接头位置我记下了，同一处再渗直接回我。', 'used', '明确维修闭环及以后联系入口。', ['home']],
  ['物业群', '公告机器人', '请大家勿在楼道堆放纸箱。', 'noise', '常规公告不改变这次维修。', []],
], s => [
  update('home', 'normal', 'done', { title: '厨房隔夜未渗水，物业已结单', summary: '隔夜未再渗水，物业已结单；留着前后照片与接头位置。', reason: '现场新照片与物业回执支持完成，仍保留查阅价值。', sources: s(1, 2) }),
  update('home-photo', 'normal', 'done', { title: '厨房前后照片已交，墙脚干燥', summary: '前后照片已交物业，今晚墙脚干燥。', reason: '已取得验证结果，不再需要高关注。', sources: s(1) }),
]);

frame(20, '09:40', '暂存列误导库存判断，是否隐藏待决定', 'second-week',
  '店长确认暂存并非库存状态，过去那句“先单独显示”仍可能误导。客户决策升到最大，根层再次占满64份；不因为bug已经修过就忽略业务口径的新证据。', [
  ['客户邮件', '许宁 · 远川工作室', '问到了：暂存其实是“顾客说晚点来拿”，没有统一规则。店长以为你们已经知道它不算库存。昨天有人看表以为还有货。', 'used', '口径缺口已产生用户误解。', ['pilot', 'pilot-data']],
  ['团队群', '唐可 · 设计', '现在它看着就是一个库存列。建议先隐藏，不要靠小字解释。我能上午改。', 'used', '有明确可执行的降低误导方案。', ['pilot', 'launch']],
  ['客户群', '店长小吴', '我又转了一遍许宁那张截图，就是刚才说的那一列。', 'duplicate', '同一误解截图，没有新增独立事件。', ['pilot']],
], s => [
  update('pilot', 'critical', 'needs-you', { title: '远川库存误读，暂存列隐藏待定', summary: '暂存不是统一库存状态，已引发误读；需决定先隐藏。', reason: '用户误解已经发生，需要负责人及时决定展示边界。', sources: s(1, 2) }),
  update('pilot-data', 'critical', 'needs-you', { title: '远川暂存不是统一库存状态', summary: '暂存属于未标准化口头约定，不能当库存列显示。', reason: '新解释推翻了之前临时展示方式。', sources: s(1) }),
  update('pilot-promise', 'high', 'needs-you', { title: '远川演示须改用新库存口径', summary: '周三演示需先说明口径变化，不继续沿用旧截图。', sources: s(1, 2) }),
]);

frame(20, '14:00', '后台补偿重跑导出4次，补偿开关已关闭', 'second-week',
  '同名告警里出现新请求来源：后台补偿任务。提升工程问题，同时缩小已完成的家庭、维修和已交接的技术笔记；腾出的份额有明确事实依据。', [
  ['监控', '体验采样机器人', 'DEMO-201：同一导出任务被后台补偿重跑 4 次，来源 scheduler；与 DEMO-174 的用户连点不同。', 'used', '看似重复的通知实际来自新执行路径。', ['performance', 'reading']],
  ['团队群', '周屿 · 工程', '确实漏了补偿任务那条路。前端幂等还在，这回要统一任务键。我已关掉补偿开关，不影响已出的报表。', 'used', '定位与临时控制都有明确回执和边界。', ['performance']],
  ['团队私信', '林苒', '刚看到告警了，别把昨天修过的那条当成回退。按新的路径写清楚。', 'used', '用户要求区分新旧问题。', ['performance']],
], s => [
  update('performance', 'high', 'in-progress', { title: '导出补偿任务重复重跑，已暂停', summary: '新问题来自后台补偿重跑；已关开关，需统一任务键。', reason: '独立的新执行路径产生重复任务，并非旧告警回声。', sources: s(1, 2, 3) }),
  update('perf-repro', 'normal', 'done', { title: '用户连点已验证，新故障在补偿', summary: '用户连点路径已验证；这次新故障来自后台补偿。', sources: s(2) }),
  update('reading', 'trace', 'fyi', { title: '任务路径：提交、取消、后台补偿', summary: '前端取消、用户提交与后台补偿是三条不同路径。', reason: '具体处置已由工程承担，此处保留辨别线索。', sources: s(2) }),
  update('family', 'low', 'done', { reason: '周末承诺已兑现并得到确认，保留成果小块，为当前误读与故障让位。' }),
  update('home', 'low', 'done', { reason: '维修已由隔夜照片验证并结单，当前只需留存入口。' }),
]);

frame(20, '19:30', '暂存列已隐藏，本月API预算定为5200元', 'second-week',
  '临时隐藏与客户解释已实际完成，试用从最大关注缩到高关注。预算已批准仍保留成果，避免在“完成”的瞬间把用户刚作出的决定抹掉。', [
  ['客户邮件', '许宁 · 远川工作室', '隐藏暂存我同意，今天导出的表已经不带它。我跟两位店长说了，明天按新表讲。', 'used', '客户确认行动发生，并有明确下游沟通。', ['pilot']],
  ['用户消息', '林苒', '预算定 5,200，不买年付。留 200 给试用增长；闲置测试环境关掉后，周五陈澄再核一次。', 'used', '实际批准金额与财务建议不同，理由明确。', ['expenses']],
  ['供应商邮件', '模型服务商营销', '最后提醒：年付优惠今晚到期。', 'duplicate', '用户已明确拒绝当前方案，营销截止不重新提高重要性。', ['expenses']],
], s => [
  update('pilot', 'high', 'in-progress', { title: '远川新表已隐藏暂存，周三演示', summary: '暂存列已隐藏且店长已知情；周三按新表演示。', reason: '误导入口已处理，仍需验证新的试用理解。', sources: s(1), due_at: stamp(21, '10:00') }),
  update('pilot-data', 'normal', 'done', { title: '远川暂存列已隐藏并说明', summary: '暂存列已隐藏，口径解释已交给两位店长。', reason: '本次纠正已完成，后续从真实试用验证。', sources: s(1) }),
  update('pilot-promise', 'normal', 'done', { title: '远川新表范围已确认并通知店长', summary: '许宁已告知两位店长，周三按隐藏暂存列的新表演示。', reason: '新表范围与说明已获客户确认。', sources: s(1) }),
  update('expenses', 'high', 'done', { title: 'API本月预算5200元已批准', summary: '本月批准5200元，暂不年付；周五核查实际趋势。', reason: '林苒刚作出的预算决定需留在眼前供确认。', sources: s(2) }),
  update('cost-limit', 'high', 'done', { title: '本月上限5200元已批准', summary: '已批准5200元，其中200元留给试用增长。', sources: s(2) }),
]);

frame(21, '09:15', '补偿任务验证通过，是否再开三店待决定', 'second-week',
  '演示前证据已较完整，但仍需林苒决定开放范围。给这项决定最大空间，性能因工程完成验证而缩小；不是到点自动完成，也不是“已读”自动降档。', [
  ['团队群', '周屿 · 工程', '补偿任务已用统一任务键，重复重跑验证通过。闲置测试环境昨晚也关了，有执行记录。', 'used', '实现与验证、费用行动都有实际回执。', ['performance', 'cost-test']],
  ['团队群', '唐可 · 设计', '新表说明补上了，我和许宁走了一遍。建议今天只再开三家熟悉的门店，别让客服同时接陌生租户。', 'used', '提出有边界的开放建议，仍等用户决定。', ['launch', 'pilot']],
  ['日历提醒', '本地日历', '10:00 远川内部演示。', 'duplicate', '日历只是提醒，重要性来自待决定范围。', ['launch']],
], s => [
  update('launch', 'critical', 'needs-you', { title: '导出发布是否再开放三店', summary: '补偿与新表说明已验证；需决定今天是否只加开三店。', reason: '开放范围仍是林苒待作的真实决定。', sources: s(1, 2), due_at: stamp(21, '10:00') }),
  update('performance', 'normal', 'done', { title: '导出补偿幂等通过验证，继续观察', summary: '补偿任务幂等验证通过，继续观察真实使用。', reason: '新执行路径修复并验证，保留观察入口即可。', sources: s(1) }),
  update('perf-repro', 'normal', 'done', { title: '用户连点与后台补偿均已验证', summary: '用户连点与后台补偿两条路径均验证通过。', sources: s(1) }),
  update('cost-test', 'normal', 'done', { title: '闲置测试环境已关闭', summary: '闲置测试环境昨晚已关闭，有执行记录。', sources: s(1) }),
]);

frame(21, '17:30', '已从两店扩到五店，暂不全量开放', 'second-week',
  '林苒选择只加开三店，结果已发生并保留。试用缩小为继续观察；把事故整理提升到可行动的小项，让重复踩坑的经验开始变成团队方法。', [
  ['用户消息', '林苒', '今天就加三家，总共五家。大家先用到周五；没有稳定反馈之前不写“全面上线”。', 'used', '明确实际范围与表达边界。', ['launch', 'pilot']],
  ['团队群', '周屿 · 工程', '三家已开。回头想把用户提交、取消、后台补偿画成一张图，不然下个人还会漏一路。', 'used', '已执行回执之外，出现值得保留的经验整理。', ['launch', 'reading']],
  ['合作伙伴群', '渠道联系人', '那我们二十家门店是不是下周就都能接了？', 'deferred', '仍未作出该承诺，先完成五店验证。', ['pilot']],
], s => [
  update('launch', 'critical', 'done', { title: '导出发布已扩至五店', summary: '已从两店扩到五店；周五前先收反馈，不称全面上线。', reason: '用户选择的小步开放已落地，需要清楚呈现这次成果。', sources: s(1, 2) }),
  update('pilot', 'normal', 'in-progress', { title: '远川五店试用，二十店未承诺', summary: '五店继续试用到周五；尚未承诺渠道二十店接入。', reason: '范围已明确，当前以观察为主。', sources: s(1), due_at: stamp(23, '18:00') }),
  update('reading', 'normal', 'in-progress', { title: '提交、取消、补偿路径图待整理', summary: '整理提交、取消、补偿三条路径，给下位同事留完整图。', reason: '真实事故形成可复用经验，值得安排一次整理。', sources: s(2) }),
]);

frame(22, '08:00', '暂无新输入，五店开放状态检查无变化', 'second-week',
  '没有新输入。昨天下午的成果还在，原有期限已过也不使条目失效；本轮没有新的重要性判断，板面保持原样。', [], []);

frame(22, '10:20', '导出重试全失败后，人工处理责任待确认', 'second-week',
  '发布成果已确认，缩小保留。原本只占一份的随手记如今指向团队交接风险：图里缺少任务失败后的人工处理责任，重新提升，仍不把文档当成已经落实的流程。', [
  ['团队群', '周屿 · 工程', '图画完初稿了，才发现重试全失败后只有日志，没人收到。需要明确谁看、何时回客户，代码不是唯一缺口。', 'used', '知识整理揭示尚未承担的责任，而非普通阅读材料。', ['reading']],
  ['团队群', '林苒', '这个我要和许宁对齐，先让客服每天看两次失败列表。正式承诺别写成即时响应。', 'used', '临时责任与服务承诺边界明确。', ['reading', 'pilot']],
  ['资讯订阅', '工程通讯', '本周推荐：大型组织的事件总线架构。', 'deferred', '当前六人团队先解决明确责任，不因阅读推荐扩大工程。', ['reading']],
], s => [
  update('launch', 'high', 'done', { reason: '用户已确认五店开放，成果保留，但注意力转向新暴露的交接缺口。' }),
  update('reading', 'high', 'needs-you', { title: '导出失败接手与回复窗口待确认', summary: '重试失败只有日志；先明确人工查看与客户回复责任。', reason: '低权重线索经过事故整理，显露尚无人承担的服务边界。', sources: s(1, 2), children: [
    item('handoff-owner', '客服每日两查失败列表，待接手', '暂由客服每天看两次，仍需确认接手。', 'high', 'in-progress', '要求已经提出，但还没有接手回执。', s(2)),
    item('handoff-promise', '失败导出处理窗口待客户确认', '跟许宁说清人工处理窗口，尚未确认。', 'high', 'needs-you', '服务承诺需要对外对齐。', s(2)),
  ] }),
]);

frame(22, '18:40', '苏禾提议周六10点约谈，等待林苒回复', 'second-week',
  '预算趋势下降，但样本尚短，缩小为周五核查。苏禾家里临时有事，提出周六再聊，林苒还未回复；恢复一点招聘关注，不把改期误读成对方失去兴趣。', [
  ['财务邮件', '陈澄 · 财务兼职', '关测试环境后日均明显下来了，目前外推约 5,080，但才两天，不能当最终账单。明晚我再核。', 'used', '趋势有改善，也明确统计限制。', ['expenses']],
  ['招聘邮件', '苏禾 · 候选人', '不好意思，家里临时要我过去，今晚又要改。周六早上十点可以吗？如果你觉得来回太折腾，也可以直说。', 'used', '第二次改期有新背景，仍有具体意愿。', ['hiring']],
  ['招聘平台', '职位周报', '本周简历查看率超过同类岗位平均水平。', 'noise', '平台指标不说明这位候选人的意愿或适配。', ['hiring']],
], s => [
  update('expenses', 'normal', 'in-progress', { title: 'API月费预测5080元，待复核', summary: '短期外推5080元，尚非最终账单；周五再核趋势。', reason: '上限已定且趋势改善，当前等待更稳的数据。', sources: s(1), due_at: stamp(23, '18:00') }),
  update('hiring', 'low', 'needs-you', { title: '苏禾提议周六10点面谈', summary: '苏禾因家事再次改约周六10点；需回复是否可行。', reason: '出现具体新安排，需用户回应而非静默过期。', sources: s(2), due_at: stamp(24, '10:00') }),
]);

frame(23, '09:40', '远川拟下周再加两店，扩展范围待决定', 'second-week',
  '五店的正面反馈值得确认，但仍有失败补救的真实例子。家人提出更简单的见面方式，林苒主动把它提高；发布成果继续缩小，注意力留给新的决定与关系。', [
  ['客户邮件', '许宁 · 远川工作室', '五家都用过了，大家说少复制很多。有一份导出失败，客服上午主动补发了。下周想先再加两家，不急着二十家。', 'used', '实际价值与仍存在的故障并存。', ['pilot', 'reading']],
  ['用户消息', '林苒', '妈妈说明天中午煮面，问我去不去。我答应了，苏禾的电话放早上，别把整个周末又塞满。', 'used', '用户明确下周末的关注与边界。', ['family', 'hiring']],
  ['监控', '体验采样机器人', '提醒：DEMO-201 的旧告警记录仍可查看。', 'duplicate', '旧记录可查不等于新故障。', ['performance']],
], s => [
  update('pilot', 'high', 'needs-you', { title: '远川已试用五店，增开两店待定', summary: '五店反馈有价值；下周再加两店待决定，失败仍需人工补救。', reason: '新增扩展请求需要依据本周真实使用作判断。', sources: s(1), due_at: stamp(26, '11:00') }),
  update('family', 'high', 'needs-you', { title: '周六中午去妈妈家吃面', summary: '周六中午去妈妈家吃面；这次安排简单，也要留住。', reason: '用户主动确认关系安排，不靠截止时间自动决定重要性。', sources: s(2), due_at: stamp(24, '12:00') }),
  update('family-date', 'high', 'done', { title: '已约周六中午到妈妈家吃面', summary: '林苒已答应周六中午去吃面，早上另有招聘电话。', sources: s(2) }),
  update('launch', 'normal', 'done', { reason: '五店开放已被持续使用确认，当前关注转向是否扩大试用。' }),
  update('handoff-owner', 'normal', 'done', { title: '客服已查看并补发失败导出', summary: '客服已按安排查看并主动补发一次失败导出。', reason: '已有实际接手与执行证据。', sources: s(1) }),
]);

frame(23, '18:20', '重复任务观察期内未再出现，事故已结单', 'second-week',
  '工程故障在观察窗口内没有再现，明确撤下；相关经验已被团队采用，缩小留存。预算核查仍保留误差范围，不能用一个漂亮数字代替最终账单。', [
  ['团队群', '周屿 · 工程', '观察窗口结束，用户连点和补偿都没再重复跑。事故单我关了，路径图和处理人已经放交接页。', 'used', '有范围明确的验证与正式结单。', ['performance', 'reading']],
  ['财务邮件', '陈澄 · 财务兼职', '再核后预测约 5,120，按目前用量可在 5,200 内。正式账单月底出，不能提前说最后就是这个数。', 'used', '趋势支持预算可控，但结果仍有待确认。', ['expenses']],
  ['团队群', '机器人', '本周工作时长排行榜已更新。', 'noise', '工作时长排名不说明成果与用户关注价值。', []],
], s => [
  withdraw('performance', '两条重复路径均已修复并经过明确观察窗口，工程正式结单；历史与来源留存。'),
  update('reading', 'low', 'done', { title: '故障交接已完成，回复窗口未确认', summary: '路径与人工接手人已写入交接页；对外窗口仍待确认。', reason: '经验整理已落地，当前不再需要高关注；未确认承诺留在摘要。', sources: s(1) }),
  update('handoff-promise', 'normal', 'in-progress', { summary: '人工补发已有实践；对外处理窗口仍待许宁确认。', reason: '内部交接已写清，客户仍未明确确认服务窗口。', sources: s(1) }),
  update('expenses', 'normal', 'in-progress', { title: 'API月费预测5120元，待出账', summary: '预测5120元，暂在5200内；月底正式账单仍待核。', sources: s(2), due_at: stamp(31, '18:00') }),
]);

frame(24, '10:30', '苏禾通话已完成，合作方式周一再谈', 'closing',
  '招聘沟通已经发生，但是否合作还没决定，不能把一次愉快通话写成招到人。家中维修已稳定数日，缩到痕迹；中午的约定仍值得保留。', [
  ['用户消息', '林苒', '和苏禾聊完了。她问的问题很具体，我也承认现在确实会救火。先各自想两天，周一再聊合作方式。', 'used', '完成的是沟通，不是录用决定。', ['hiring']],
  ['用户消息', '林苒', '厨房这几天都干的，先不用每天提醒我看墙了。我现在出门去妈妈那儿。', 'used', '用户确认稳定与提醒偏好，出门意图不是到达证明。', ['home', 'family']],
  ['日历提醒', '本地日历', '10:00 与苏禾沟通（演示日程）。', 'duplicate', '沟通结果已由用户确认，旧提醒没有新信息。', ['hiring']],
], s => [
  update('hiring', 'low', 'in-progress', { title: '苏禾面谈已完成，合作仍待定', summary: '周六通话已完成；双方各想两天，周一讨论合作方式。', sources: s(1), due_at: stamp(26, '10:00') }),
  update('home', 'trace', 'done', { title: '厨房数日未再渗水', summary: '数日未再渗水；保留维修记录，不再反复提醒。', reason: '林苒确认结果稳定，并明确无需每天提醒。', sources: s(2) }),
]);

frame(24, '20:00', '苏禾要求参与需求取舍，合作条件待商定', 'closing',
  '候选人的反馈与刚经历的事故相互照亮：团队真正缺的是能做决定的设计伙伴。提高招聘判断，尊重用户对“别再招一个只接需求的人”的批注；家庭成果仍可见。', [
  ['招聘邮件', '苏禾 · 候选人', '我愿意继续聊。但如果职责只有赶稿，我可能不适合。能不能下次一起看一个你们真的删掉过的需求？', 'used', '合作条件指向工作方式，需要创始团队认真决定。', ['hiring']],
  ['用户消息', '林苒', '今天面吃上了，妈妈还打包了一盒。回来想了想，苏禾说得对，我们得留时间想清楚，不是再找个人顶住。', 'used', '关系成果与团队反思并存。', ['family', 'hiring']],
  ['团队群', '周屿 · 工程', '发一张今天骑车的照片，大家周末快乐。', 'noise', '普通生活分享无须转成新的事项。', []],
], s => [
  update('hiring', 'high', 'needs-you', { title: '苏禾合作：需参与需求取舍', summary: '苏禾愿继续聊，前提是参与取舍；周一带真实删需求的例子。', reason: '候选人的条件与用户反思一致，这是团队工作方式的决定。', sources: s(1, 2) }),
  update('family', 'high', 'done', { title: '已去妈妈家吃面', summary: '中午去妈妈家吃了面；这次简单的约定也兑现了。', reason: '用户明确确认完成，保留新的关系成果。', sources: s(2) }),
], { annotations: [{ id: 'ann-hiring', item: 'hiring', author: '林苒', text: '别再招一个只接需求的人。下次聊之前，提醒我带这两周真实做过的取舍。', at: stamp(24, '20:00') }] });
frames[32].batch.acknowledges = ['ann-hiring'];

frame(25, '19:40', '苏禾合作与新增两店待决，月底API账单待核', 'closing',
  '周日不做虚假的清零：招聘方式、下周两店扩展、月底费用仍未最终完成。两次家人约定、有限发布和维修结果缩小留存。板面空出来，是因为有了新的理解与明确取舍。', [
  ['用户消息', '林苒', '下周先不冲二十家。周一跟苏禾聊之前，我想拿“暂存列先隐藏”这个例子，说说我们愿不愿意少做一点。', 'used', '用户把过去的取舍转成下一轮明确的讨论材料。', ['hiring', 'pilot']],
  ['团队群', '周屿 · 工程', '我把交接页和发布记录补齐了。月底账单还要看，五店以外先不开，周一一起决定。', 'used', '哪些完成、哪些等待决定有清楚边界。', ['launch', 'expenses', 'reading']],
  ['资讯订阅', '创业周报', '本周必读：从 0 到 100 家客户的十个增长技巧。', 'deferred', '增长文章不覆盖用户明确选择的小步验证。', ['pilot']],
], s => [
  update('pilot', 'normal', 'needs-you', { summary: '五店继续用；下周加两店待周一决定，不追二十店。', reason: '用户明确选择小步验证，等待周一集中决定。', sources: s(1, 2), due_at: stamp(26, '11:00') }),
  update('launch', 'low', 'done', { title: '导出五店已开放，发布记录齐全', summary: '五店开放与发布记录已完成；更大范围没有被承诺。', reason: '成果与边界已有完整记录，可缩小保留。', sources: s(2) }),
  update('family', 'normal', 'done', { title: '已陪妈妈逛东馆、吃面', summary: '两周里兑现了东馆和吃面两次约定，保留这份成果。', reason: '用户已确认两次相处完成，留小块回望而非占据决策空间。' }),
  update('expenses', 'low', 'in-progress', { summary: '5200元上限已定，当前预测5120；月底仍需核正式账单。', reason: '当前趋势可控，正式结果尚未出现，保留而不宣称完结。', sources: s(2) }),
  update('reading', 'trace', 'done', { summary: '取消与幂等经验已交接；对外处理窗口仍待确认。', reason: '经验整理已完成并交接，现在只需留一个入口，保留未确认边界。', sources: s(2) }),
  update('hiring', 'high', 'needs-you', { title: '苏禾合作：周一谈参与需求取舍', summary: '周一与苏禾谈合作方式，带上隐藏暂存列的真实取舍。', sources: s(1) }),
]);

// Prepend after authoring f01..f34 so their IDs, event references, and feedback
// attachments stay stable. The first frame is a view of the untouched state.
const coldFirstEvents = [
  { id: 'cold-01-e01', channel: '用户消息', from: '林苒', at: stamp(12, '08:34'), text: '我刚到办公室。今天想先把这版到底做什么定下来，你帮我记着，别一忙又直接开工了。', disposition: 'used', why: '用户明确交代一件今天要作的决定，具体范围还未知。', relatedIds: ['launch'] },
  { id: 'cold-01-e02', channel: '同楼群', from: '咖啡拼单', at: stamp(12, '08:38'), text: '楼下咖啡买二送一，有人一起吗？九点前接龙。', disposition: 'noise', why: '普通拼单信息，不影响已交代的发布决定。', relatedIds: [] },
  { id: 'cold-01-e03', channel: '用户消息', from: '林苒', at: stamp(12, '08:40'), text: '主要是导出这块。先把必需的范围拎清楚，具体哪些做，我还没想定。', disposition: 'used', why: '补充同一决定的主题，仍没有具体功能或发布时间。', relatedIds: ['launch'] },
];
const coldSecondEvents = [
  { id: 'cold-02-e01', channel: '家人消息', from: '妈妈', at: stamp(12, '08:44'), text: '这周末你有空吗？我想和你一起出去走走。', disposition: 'used', why: '新的家庭安排提议，日期与去处尚未确定。', relatedIds: ['family'] },
  { id: 'cold-02-e02', channel: '用户消息', from: '林苒', at: stamp(12, '08:47'), text: '周末留半天给妈妈，这件事我答应了。具体哪天、去哪儿，晚点再跟她定。', disposition: 'used', why: '用户确认要兑现相处时间，具体行程仍待商量。', relatedIds: ['family'] },
  { id: 'cold-02-e03', channel: '团队私信', from: '周屿 · 工程', at: stamp(12, '08:50'), text: '导出范围今天得等你拍板，唐可和我都按这个往下做。你到办公室我们先对一下。', disposition: 'used', why: '明确有两位同事在等待范围决定，提升今天处理它的价值。', relatedIds: ['launch'] },
];
const coldSources = (events, observedAt, ...indices) => indices.map(index => ({
  channel: events[index].channel, author: events[index].from, ref: `event:${events[index].id}`,
  quote: events[index].text, observed_at: observedAt,
}));
const coldFrames = [
  {
    id: 'cold-00', at: stamp(12, '08:30'), phase: 'initial', title: '暂无关注事项，尚未收到首批输入', chapter: 'cold-start',
    narrative: '早上八点半，林苒还没有交代今天的事情。眼前是空白，等第一条真正需要记住的消息。',
    events: [], batch: null,
  },
  {
    id: 'cold-01', at: stamp(12, '08:42'), title: '今天要定导出范围，具体功能尚未决定', chapter: 'cold-start',
    narrative: '林苒先交代今天要定导出范围。现在只知道这一件待决定的事，先留一小块；具体功能与发布时间还未知。咖啡拼单留在消息里。',
    events: coldFirstEvents,
    batch: { batch_id: 'shanghai-cold-01', actor: 'assistant', declarations: [
      item('launch', '导出范围今天需拍板', '今天先定这版的导出范围；具体做哪些还未想定。', 'normal', 'needs-you', '用户明确交代今天作决定，先按当前有限信息保留关注。', coldSources(coldFirstEvents, stamp(12, '08:42'), 0, 2)),
    ], acknowledges: [] },
  },
  {
    id: 'cold-02', at: stamp(12, '08:52'), title: '导出范围待拍板，周末已答应陪妈妈', chapter: 'cold-start',
    narrative: '工程补充了谁在等林苒拍板，发布范围值得放大。她也答应周末陪妈妈，添上第二块；日子与去处尚未定，不提前展开行程。',
    events: coldSecondEvents,
    batch: { batch_id: 'shanghai-cold-02', actor: 'assistant', declarations: [
      update('launch', 'high', 'needs-you', { summary: '今天要定导出范围；周屿和唐可都在等这项决定。', reason: '工程说明两位同事的后续工作依赖林苒拍板。', sources: coldSources(coldSecondEvents, stamp(12, '08:52'), 2) }),
      item('family', '周末陪妈妈半天，行程待定', '已答应周末陪妈妈；具体哪天、去哪儿还要商量。', 'normal', 'needs-you', '用户确认相处约定，先保留承诺，不假定行程已确定。', coldSources(coldSecondEvents, stamp(12, '08:52'), 0, 1)),
    ], acknowledges: [] },
  },
];
frames.unshift(...coldFrames);

export const scenario = {
  id: 'shanghai-two-weeks',
  title: '林苒的事项回放',
  subtitle: '10月12日—25日 · 产品发布、客户试用、费用、家人与招聘',
  persona: { name: '林苒', role: '上海 · 六人团队产品负责人', context: '在一个六人团队做门店协作产品「拾页」。最近一轮试用，恰好撞上答应妈妈的周末、家中维修和一次反复改期的招聘。人物、公司、私人消息、指标、费用与日程均为演示创作。' },
  startAt: frames[0].at, endAt: frames.at(-1).at, timeZone: 'Asia/Shanghai',
  categories: {
    launch: { label: '产品发布', colorKey: 'sage' },
    pilot: { label: '客户试用', colorKey: 'clay' },
    performance: { label: '运行体验', colorKey: 'sand' },
    'invoice-mail': { label: '费用邮件', colorKey: 'sand' },
    'invoice-chat': { label: '账单线索', colorKey: 'sand' },
    expenses: { label: '费用与预算', colorKey: 'sand' },
    family: { label: '家人与生活', colorKey: 'lilac' },
    home: { label: '家中维修', colorKey: 'blue' },
    hiring: { label: '团队与招聘', colorKey: 'lilac' },
    reading: { label: '线索与经验', colorKey: 'mint' },
  },
  publicSources: [
    { id: 'inp', title: 'web.dev · Interaction to Next Paint', url: 'https://web.dev/articles/inp', fact: 'INP衡量交互响应；现场p75≤200ms为良好、>500ms为差，实验与现场测量需区分。', usedFor: '解释故事中的性能信号。样本数量与全部产品指标为虚构，阈值不直接决定Fold权重。', verifiedAt: '2026-10-10' },
    { id: 'abort-controller', title: 'MDN · AbortController', url: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortController', fact: 'AbortController可以中止fetch、响应体读取与流。', usedFor: '为取消请求线索提供真实技术背景；故事中的服务端行为是演示设计，不是MDN保证或真实事故。', verifiedAt: '2026-10-10' },
    { id: 'museum-east', title: '上海博物馆 · 东馆参观指南', url: 'https://www.shanghaimuseum.cn/mu/frontend/pg/m/service/visit-east', fact: '东馆位于世纪大道1952号；常规10:00—18:00开放，17:00停止入场，周二闭馆，国定节假日除外。', usedFor: '家人出行的公开背景；见面、参观与双方消息全部为演示创作，不代表已预订或未来开放保证。', verifiedAt: '2026-10-10' },
  ],
  chapters: [
    { id: 'cold-start', title: '10月12日早晨 · 导出范围与陪妈妈安排' },
    { id: 'opening', title: '10月12—13日 · 筛选故障复现与账单去重' },
    { id: 'pressure', title: '10月13—16日 · 两店试用上线与厨房维修' },
    { id: 'weekend', title: '10月16—18日 · 周末陪妈妈与厨房返修' },
    { id: 'second-week', title: '10月19—23日 · 库存口径、五店开放与API预算' },
    { id: 'closing', title: '10月24—25日 · 设计师合作条件与下周扩店' },
  ],
  frames,
};

export default scenario;
