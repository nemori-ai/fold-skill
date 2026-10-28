// Concept cards shown on each form page and in the gallery. Keep in step with CONCEPTS.md.
// Round one built ten forms; the two-week small multiples survived review, and the user later
// chose to keep the wrist glance as well (see CONCEPTS.md).
// Round two adds five pages (below) that began as single-frame sketches and are now full pages
// with frame navigation, hover and detail; they carry no concept panel.
export const forms = [
  {
    id: 'watch', no: 1, name: '腕上一瞥', frame: 14, theme: 'light',
    tagline: '整份状态压成一圈 64 个刻度和一个数：抬腕两秒，只回答“有没有等我回应的事”。每次换轮只动三拍：刻度重分、新要你回的那几件闪一下、数字落定。',
    carrier: '手表表盘、卡片堆、回应屏', scene: '会议间隙、走路时抬腕', usage: '被动一瞥，必要时点按回应；悬停刻度或事项名看概要，点击展开详情',
    question: '有没有等我回应的事？最大的是哪件？',
    channel: '角度 → 份额（一格一份，按排名顺时针）；朱红 → 登记了回应路径；大字号 → 等你回应的件数。',
    skeleton: '表盘：一圈刻度 + 中央大数字\n卡片堆：最前一张 + 后面露边\n回应屏：问题 + 两颗大按钮',
    discard: '摘要、来源、子层结构；没有回应路径的事只剩灰色刻度。',
    diff: '不铺开任何事项。D 的卡片在这里只剩最前一张加露边。',
    palette: '表盘是黑底 OLED 惯例，朱红只给回应路径。',
    inspiration: 'Nest Farsight、Smart Stack、灵动岛、Pebble、手表触觉',
  },
  {
    id: 'multiples', no: 8, name: '两周小倍数', frame: 14, theme: 'light',
    tagline: '每帧同尺度并排，每帧 8×8 = 64 格，两周累计份额前 8 件各一色、其余灰：一眼看完两周注意力怎样移动；放一遍约 24 秒，看出它是成块挪的。',
    carrier: '海报或大屏', scene: '复盘两周、会前回顾', usage: '直接打开先放一遍（任意键跳过，▶ 重放）；悬停一帧或一格看概要，点一格展开这一件，←/→ 逐帧',
    question: '注意力怎样移动？某件事何时变大、何时消失？',
    channel: '位置 → 时间（按日分行）；颜色 → 前 8 件的身份（其余灰），可切换为流；格数 → 份额；黑点 → 一个开着的问题；大数 → 本轮换手的格数。',
    skeleton: '按日期分行的小方阵（每帧一个），旁注这一帧的标题\n右侧：此刻的放大方阵、开着的问题、前 8 件的走势',
    discard: '方阵里不写摘要，也不画子层；摘要、依据与原文收进点开后的详情。',
    diff: 'B 是连续的带，这里是离散、同尺度、同时可见的快照。',
    palette: '纸白底；8 种身份色只给累计份额前 8 的事项，其余灰；按流时蓝 = 工作、橙 = 生活、绿 = 社区。',
    inspiration: 'Muybridge、GitHub 贡献日历、状态页历史条、sparklines',
  },
];

// Round one's eight withdrawn forms, restored on 2026-10-15 so every prototype can be seen on one page
// (all.html). They run on both datasets with only the minimum adaptation and are not polished; the
// concept cards are the round-one text, kept in step with CONCEPTS.md「第一轮做的十个形式」.
export const withdrawn = [
  {
    id: 'radio', round: 1, withdrawn: true, no: 2, name: '晨间朗读', frame: 14, theme: 'light',
    tagline: '份额变成播报秒数：每份约 1.5 秒，64 份上限 96 秒，未分配就是提前结束。',
    carrier: '耳机或音箱，配朗读稿', scene: '通勤、做早饭', usage: '线性收听，可说“下一件”“展开”',
    question: '不看屏幕，一分多钟里能听到该知道的吗？',
    channel: '时长 → 份额（决定读几句）；先后 → 排名；未分配 → 提前结束的时间。',
    skeleton: '顶部一条播报时间轴，段长 = 份额，灰段 = 未分配\n下方朗读稿，正在读的句子高亮',
    discard: '空间总览与并排比较；子层只在展开时读。',
    diff: '唯一不依赖视觉的形式；份额第一次变成“占你多少秒”。',
    palette: '朗读稿纸白墨绿；浅黄高亮只表示正在读。',
    inspiration: 'Alexa Flash Briefing、屏幕阅读器标题导航、驾驶场景、Espresso',
  },
  {
    id: 'strips', round: 1, withdrawn: true, no: 3, name: '进程条架', frame: 14, theme: 'dark',
    tagline: '每件事是一张固定格式的纸条，按阶段插在四个槽里；本轮改动用蓝墨水就地手写。',
    carrier: '工作站或平板上的条架', scene: '白天值守、多 Agent 并行', usage: '主动巡视，拿起一条看子项',
    question: '每件事处在哪个阶段？这一轮改了哪一格？',
    channel: '位置 → 阶段（四个槽）；大数字与刻度 → 份额；蓝墨水 → 本轮改动。',
    skeleton: '深灰条架上四个槽，米黄纸条等高排列\n条左大数字是份额，中间标题，右侧固定字段',
    discard: '分量感：所有条等高，只有数字与刻度说份额。',
    diff: '固定字段的密表格，按阶段分槽而不是按份额铺版；改动就地可见。',
    palette: '深灰条架、米黄纸条、黑色印字；蓝墨水只用于本轮改动。',
    inspiration: '飞行进程单、Bloomberg、分诊牌、安灯看板',
  },
  {
    id: 'frontpage', round: 1, withdrawn: true, no: 4, name: '头版', frame: 14, theme: 'light',
    tagline: '8 栏 × 8 行 = 64 格的报纸版面：份额决定占几格与标题字号，留白照实印出。',
    carrier: '报纸版面，可打印', scene: '周末早餐、离开半天后深读', usage: '主动阅读，用笔批注',
    question: '这一轮最大的新闻是什么？其余各占多大版面？',
    channel: '面积与标题字号 → 份额；左上起 → 排名；报耳 → 等你件数与本轮输入。',
    skeleton: '报头两侧各一个报耳，下面整版栏网格\n最大一件是通栏标题，小事是一栏短讯，留白格写明份数',
    discard: '时间演变与动效；一期一印。',
    diff: '编辑排版语法：标题、导语、正文、栏线。A 是散落纸片，这里是有网格的整版。',
    palette: '新闻纸米白与黑色衬线；红色只用于“需要你”的栏头。',
    inspiration: '报纸头版、Espresso、Morning Brew、TRMNL',
  },
  {
    id: 'receipt', round: 1, withdrawn: true, no: 5, name: '小票', frame: 14, theme: 'light',
    tagline: '每份 14 像素的热敏纸：纸越长越重要，上一张与这一张并排比较。',
    carrier: '58 毫米热敏纸卷', scene: '早上桌上打出一张', usage: '被动接收，撕下带走，方框里打勾',
    question: '这一期有什么？和上一张比哪件变长了、哪件没了？',
    channel: '纸长 → 份额（左侧一格一份的刻度尺）；走纸留白 → 未分配；并排 → 比较。',
    skeleton: '两条窄纸并排：左上一张，右这一张\n每件事一段，长度等于份额，末尾留白与撕纸线',
    discard: '颜色、交互、子层（只印子项数）；勾选不回传。',
    diff: '一维的长度编码，物理可带走；比较靠并排而不是动画。',
    palette: '热敏纸只有黑色。',
    inspiration: 'BERG Little Printer、Espresso、Muybridge 的同尺度',
  },
  {
    id: 'orb', round: 1, withdrawn: true, no: 6, name: '环境球', frame: 14, theme: 'dark',
    tagline: '不读字的形式：球色说有没有等你回应的事，亮度说占多少份，呼吸说本轮新来了。',
    carrier: '桌上发光球与 64 灯底座', scene: '在场工作，余光里', usage: '完全被动；按一下说出最大那件',
    question: '现在要不要分心看一下？',
    channel: '色相 → 有无回应路径；亮度 → 等你回应的份额；呼吸 → 本轮新增；底座一灯一份。',
    skeleton: '暗房间里一颗球与一圈底座灯\n右侧解码面板写出精确数字，下方 37 帧的球色条',
    discard: '几乎全部文字。',
    diff: '唯一不需要阅读的形式：决定“要不要去看”，而不是“看什么”。',
    palette: '暗色房间才看得出光；暖橙只表示等你回应。',
    inspiration: 'Ambient Orb、Nabaztag、Dangling String、Calm Technology',
  },
  {
    id: 'departures', round: 1, withdrawn: true, no: 7, name: '到期时刻表', frame: 14, theme: 'dark',
    tagline: '按“几点到期”而不是按份额排：车站翻牌屏，变了的行才翻牌。',
    carrier: '走廊或车站式翻牌大屏', scene: '规划今天、看接下来', usage: '路过扫一眼，变化时翻牌',
    question: '接下来几点会有什么到期？哪些已经过点？',
    channel: '纵向位置 → 到期时间；琥珀色 → 等你回应；翻牌 → 本轮变化；份额是一列数字。',
    skeleton: '黑色大屏，上半“前方”按到期时间一行一件\n下半“未定时”放没有期限的事',
    discard: '按份额排序；没有期限的事退到下半块。',
    diff: '唯一按将来时间组织的形式。B 看过去，这里看此刻往后。',
    palette: 'Solari 黑板白字，琥珀只给等你回应。',
    inspiration: 'Solari 翻牌屏、任务控制室倒计时、Pebble 将来方向',
  },
  {
    id: 'blame', round: 1, withdrawn: true, no: 9, name: '出处栏', frame: 14, theme: 'light',
    tagline: '状态写成一份文档，每一行左边写着它来自哪一轮、哪条输入、多久没变。',
    carrier: '桌面等宽文档视图', scene: '对某条表述有疑问、复核整理时', usage: '主动核对，点出处看原文与改动',
    question: '这句话是哪一轮、根据什么写的？多久没变了？',
    channel: '左缘色带 → 新旧；缩进 → 层级；左栏文字 → 出处；份额写成 [24] 与短刻度。',
    skeleton: '左栏：多久前 · 哪一轮 · 来源\n右栏：等宽文档，## 标题 [份额]，摘要，子项缩进',
    discard: '版面层级与分量感；所有事项同字号。',
    diff: '文本优先、出处优先；A/B/C/D 把出处放进详情，这里每一行都带着它。',
    palette: '代码视图白底；橙色深浅只表示距上次改动多久。',
    inspiration: 'git blame、Memento、Linear Inbox、病房白板',
  },
  {
    id: 'chat', round: 1, withdrawn: true, no: 10, name: '对话线程', frame: 14, theme: 'light',
    tagline: '每次整理是一条助理消息，状态是置顶附件；等你回应的问题带着快捷回复。',
    carrier: '即时通讯的助理会话', scene: '被打断后回来、手机上随手看', usage: '读最新几条，用快捷回复就地回应',
    question: '刚才发生了什么？现在要我回什么？',
    channel: '先后 → 批次；左右 → 发言人；按钮 → 登记了回应路径；置顶 → 当前份额前三名与未分配。',
    skeleton: '顶部置顶条，中间消息流\n左侧助理气泡，右侧林苒的消息、按钮与批注',
    discard: '总览版面；完整状态只在置顶展开时出现。',
    diff: '变化流为主体、状态为置顶附件；D 是状态首页，这里是消息流。',
    palette: '通讯软件浅灰底与白气泡；墨绿只用于可点的回复按钮。',
    inspiration: 'Linear Inbox、Slack Catch up、Morning Brew 的口语导语',
  },
];

// Round-two pages: each drawn for a relation no earlier form shows; `frame` is the story default. `last` opens every
// dataset on its last frame (the dataset's `sketchFrames` is not used); `usage` replaces the gallery's “完整版 · 可逐帧”.
// Keep in step with the round-two concept cards in CONCEPTS.md.
export const sketches = [
  { id: 'lineage', no: 1, name: '身份线', frame: 'f34',
    relation: '同一件事在两周里被改写成什么：叫什么、占多大，何时撤下又以同一身份恢复，何时与另一件并成一件，问题何时开、何时关。',
    color: '颜色 = 事项身份' },
  { id: 'timing', no: 2, name: '回应时序', frame: 'f30',
    relation: '每条回应路径的开与闭：问了你什么、开了多久，是被你的回复关上，还是改写后悄悄失效，又和期限谁先到。',
    usage: '直接打开先讲一遍约 24 秒：开得最久的问题，最后是别人先开了口；悬停看概要，点击展开',
    color: '朱红 = 你的回应' },
  { id: 'provenance', no: 3, name: '来源矩阵', frame: 'f34',
    relation: '每件事由谁推动：谁的输入被用到了哪件事、在哪几天，每个来源又有多少被判为重复、暂缓或噪音。',
    color: '颜色 = 事项身份' },
  { id: 'yield', no: 4, name: '让位图', frame: 'f15',
    relation: '每一轮份额从谁那里来、到谁那里去：一件事变大，必有别的事让位或动用留白，两边永远相等。直接打开时讲一遍三拍：份额从哪来、问题关上、退回的份额到哪去。',
    color: '颜色 = 事项身份' },
  { id: 'notation', no: 5, name: '批次记谱', frame: 'f34', last: true,
    relation: '每一轮整理由什么组成：收到几条、各怎么判，对哪几件事做了什么；两周里整理的疏密，和你插话的时刻。',
    usage: '直接打开先演 12 秒：读得越多丢得越多，动的却不跟着多；悬停看概要，点击展开',
    color: '朱红 = 来自你本人' },
  { id: 'morph', no: 9, name: '变形', frame: 'f34', last: true,
    relation: '同一批事项留在原位，面积从“收到多少条输入”变成“占多少份”：收到最多的那件不一定给得最多，这段变形就是 Agent 的判断；黑是家里，白是工作。',
    usage: '直接打开先讲一遍约 7 秒：141 条只给 6 份，29 条给了 24 份；M 切换收到⇄给出，悬停看概要，点击展开',
    color: '黑 = 家里 · 白 = 工作' },
  { id: 'peak', no: 12, name: '峰值保持', frame: 'f20',
    relation: '上次接触锚点之后的起落：你不在的时候升起又落下、此刻已经看不出来的事；峰值一直停着，直到你按“已阅”。',
    usage: '直接打开先讲一遍约 11 秒：你不在、此刻看不出来、已阅；悬停看概要，点击展开',
    color: '朱红 = 已阅' },
  { id: 'age', no: 8, name: '驻龄', frame: 'f26', relation: '此刻的 64 份里，每一份已经在当前这件事上连续待了几轮：多少是沉淀的，多少是刚换手的。格子两周不挪，只在份额易手时换主人，圈数就是驻龄。', usage: '直接打开先讲一遍约 23 秒：一轮三个动作，清出、加圈、新框；悬停看概要，点击展开', color: '墨黑 · 圈数 = 驻龄' },
  { id: 'chain', no: 10, name: '等待链', frame: 'f34', last: true,
    relation: '谁在等谁、你挡住了谁：每个开着的问题后面站着哪些人、各等了多久，答了之后哪一环才能动；谁在等由规则从依据里现算。',
    usage: '直接打开先讲一遍约 12 秒：谁在等、你开口、一串人松开；悬停一行或一个人看概要，点击展开',
    color: '朱红 = 你（脊与结）' },
  { id: 'tug', no: 6, name: '拔河', frame: 'f26',
    relation: '家里与工作在 64 份里此消彼长：谁领先、领先多少、哪一轮被哪件事拉过中线，以及你在来源处实际在哪一边动手。',
    usage: '直接打开先讲一遍约 23 秒：份额说家里重，手却在工作上；家里坠到 59 : 5；一天后弹回；悬停看概要，点击展开',
    color: '朱红 = 你的回应' },
];

// Round three: concept animations for the site, each reading the same replay as every other form. Fields as in
// `forms`, plus `page` (relative to forms/). Keep in step with CONCEPTS.md「第三轮：概念动画」.
export const motions = [
  {
    id: 'pulse', no: 1, name: '整理脉冲', frame: 20, theme: 'dark', page: 'motion/pulse.html',
    tagline: '一轮整理演成 4.25 秒的一次脉冲：上百条落下成云，一道弧向根收拢，只有几颗落到根上、化成光顺着枝流上去，要你开口的那一件打出朱红线。',
    carrier: '官网首屏、讲解用的大屏', scene: '第一次看 Fold，想知道它在做什么', usage: '自动连播两周；←/→ 逐轮重放一次脉冲；悬停枝条看概要，点击展开详情，两者都让本轮停在当前时刻，详情里的问题链到同一帧的 D 去回答',
    question: '每一轮进来多少、留下几件、哪件要我开口？',
    channel: '左上大数字 → 本轮收到几条；云里一颗亮粒子 → 一条输入（按流分扇区）；落到根上、再顺枝流上去 → 被采用；外沿外的余烬 → 暂缓；枝的粗细与长短 → 份额；根上 64 格与放射的 64 条份额线 → 预算（虚线是还没分出去的）；朱红 → 回应路径。',
    skeleton: '左上：本轮收到 N（全场最大的字）\n外圈：扇形外沿之外的粒子云，一道与根同心的弧从外向根收拢\n底部中央：64 格的弧形根，64 条份额线与枝向左右扇形展开，朱红线从枝梢打到根\n最下：本轮、开着的问题、流水线三块面板',
    discard: '主画面不写摘要、来源与子层，只在点开的详情里；不承载作答，只标问题的开与闭。',
    diff: '批次记谱把一轮记成一行，这里把一轮演成一次脉冲；份额拨盘演的是 64 份怎样分、谁让位，这里演的是一轮里多少进来、几件留下、哪件要你开口。',
    palette: '近黑底，灰白的细线与粒子；朱红只给回应路径：新登记的问题、你的回应、答掉后的记号。',
    inspiration: '视频 A（@Bober_smart）的心跳、错拍时钟与单点高亮；视频 B（@francescoinweb3）的面板回声',
  },
  {
    id: 'dial', no: 2, name: '份额拨盘', frame: 26, theme: 'light', page: 'motion/dial.html',
    tagline: '整份状态是一圈 64 格的刻度：每一轮成百条输入沿车道涌进来，只有十几件留在环上；一件变大，别的就得让；游标只停在要紧、等你回的那一件上。',
    carrier: '官网首屏的概念动画，也能逐帧停下', scene: '第一次看 Fold 的人，20 秒', usage: '默认循环 20 秒三拍；空格连播全部轮次，←/→ 逐帧；悬停扇区看概要，点击展开详情，两者都让播放停在当前轮，详情里的问题链到同一帧的 D 去回答',
    question: '64 份是怎样的硬约束？成百条进来之后环上剩下什么、谁让了位、哪一件要我回？',
    channel: '角度 → 份额（64 刻度，硬止刻在 0/64）；车道上的墨色记号 → 本轮真实输入；黑游标 → 要紧的问题；朱红 → 只给等你回的问题。',
    skeleton: '左：64 格份额环，环心一个大字 64，环外一圈旋转的字形\n右：五条车道向环汇入，墨色记号是真实输入，灰色是质感\n上：旁白卡与计数；下：五块小仪表',
    discard: '摘要、来源、子层与作答；1–3 份的扇区不标名字；“谁让给谁”的配对（回执里没有）。',
    diff: '其他形式画此刻或复盘；这里把一轮整理本身演出来：输入涌入、归并、份额落定、游标落下。概念层约八成、信息层约两成，信息只在节拍上动。',
    palette: '纸白、墨黑与灰阶；朱红只给等你回的问题。',
    inspiration: '视频 B（@francescoinweb3 的工作室仪表）：0.4 秒的第一个动作、一帧硬切、亮的极少',
  },
];

export const formById = id => forms.find(form => form.id === id) || withdrawn.find(form => form.id === id) || motions.find(form => form.id === id);

// The local preview serves Markdown as files; the documentation site publishes it as pages.
export const notesHref = name => (location.port === '4173' || location.protocol === 'file:' ? `${name}.md` : `/prototype-notes/forms/${name}`);
