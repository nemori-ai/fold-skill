# Fold 时光机原型

用于回答：Agent 把工作与生活交织的两周整理成一份有预算的状态之后，人在不同场景下怎样读懂它、怎样回应？同一份回放有十二种表达形式，共用一套回应组件。原型可作为体验站发布，仍为独立实验；Fold CLI 尚未实现。

## 运行

在仓库根目录运行：

```sh
make prototype
```

打开 http://127.0.0.1:4173 ；想一次看完所有原型，打开[全部原型合页](./all.html)。只需 Python 3，无需安装前端依赖。预览服务禁用缓存，修改后刷新即可看到最新版本。所有内容在浏览器内存中回放，不连接真实账户，不持久化数据。

## 演示数据

所有页面（原版、A/B/C/D、形式画廊、合页、腕上一瞥、小倍数、五张复盘图与第一轮撤下的八个形式）都从 `scenario.mjs` 读同一份回放，用 `?data=<名字>` 选择数据集，在原型内点链接会带上这个选择；可选的数据集登记在 [data/select.mjs](data/select.mjs)：

| `?data=` | 内容 |
| --- | --- |
| `composite`（默认） | [data/composite/scenario.mjs](data/composite/scenario.mjs)：化名人物 Jonas Berglund 的两周，[混合语料](../corpus/composite/MIX.md)的输入：29 帧，`f00` 是空状态，其后 28 帧共 3196 条（四条流是化名改写的真实公开数据，另有作者编写的家庭流 388 条；正文截到 500 字，去掉了 21 封 Enron 营销邮件）。判断来自混合语料上的第二次自由运行（`free-20261015-161501`，`claude-opus-5-5`，31 次调用，23.23 美元，报告见[评测记录](../docs/evaluations/free-run-composite-v2-2026-10-15.md)），再经人工打磨：对 Agent 批次的修正 9 处、手写反馈链接 4 处，登记回应路径 26 条（都带短问法），从本人后续动作推出反馈链接 160 条。由 `scripts/build_demo_data.py` 从 Agent 批次（[agent-batches.json](data/composite/agent-batches.json)）与修正（[edits.json](data/composite/edits.json)）重放生成，修正逐条记在 [POLISH.md](data/composite/POLISH.md)；各流的来源、许可、引用长度与化名处理见 [SOURCES.md](data/composite/SOURCES.md)，改写文本已于 2026-10-15 由用户决定随站点公开。 |
| `story` | [data/story/scenario.mjs](data/story/scenario.mjs)：作者手写的林苒两周，37 帧、112 条输入，判断全部预先编排（[STORY.md](STORY.md)）。判断评测（`scripts/eval_judgment.py`）读的也是它。 |

每个数据集在 `select.mjs` 里带一句 `notice`，页面在数据旁照写，说明人物、输入与判断从哪里来。

每个数据集导出同形的 `scenario`：`persona`、`categories`（根层事项的稳定称呼：`label`、`colorKey`、`color`、`short`）、`feedback`（业务用途与默认反馈动作）、`frames`。每帧有 `id`、`at`、`title`（旁白）、`events`、`batch`（交给内核重放的声明批次），以及三项宿主侧记录，它们不进 Fold 状态：

- **`frame.asks`：回应路径。** 以条目 ID 为键，一件事此刻最多一条。字段：`id`（同一问题重登记时不变）、`item`、`registered_at`、`due_at`（问题自己的截止，可为 null）、`expects`（回应控件：confirm / choose / reply / schedule / approve / defer）、`meanings`（[领域模型](../docs/domain-model.md)里对用户的期待：decide / input / act）、`prompt`、`short`（可选，16 字以内的短问法，供只放得下一行的形式，如腕上一瞥）、`actions`（`{id, label, meaning, recommended?, input?}`；input 有 `type`：text / money / photo / datetime）、`subject`（approve 要批准的外部动作，`{label, url?}`）、`handler`。一条 ask 属于登记时的条目版本（`updated_at`）；条目被改写而这一帧没有重登记，就视为没有登记回应路径。
- **`event.feedback`：用户反馈。** 事件上的数组，每项 `{ask?, target, action, meaning, via, value?, until?}`；`meaning` 为 ack / decide / input / act / snooze，`via` 为 button（Fold 里登记的按钮）、reply（回复 Agent 的消息）或 source（在来源处直接处理：GitHub 上评审、合并、关闭，论坛与问答站上回复）。via 为 source 时 `action` 取自 `feedback.sourceActions`（含家庭流里的通话 `call`、表情 `react`、转账 `pay`），或映射到那条 ask 最接近的按钮。到点提醒是另一种事件，带 `reminder: {feedback, target, requested_at}`。
- **事件的来源标注。** 真实语料的事件另有 `stream`（work / family / community / life / subscription）、`self`（本人发出）与 `author_kind`（bot / automation，人类不写），供形式区分“你自己”“机器”与“订阅”；家庭流里不是普通消息的事件另带 `kind`（call_log、reaction、swish_sent 等），形式据此把本人的动作写成“给诊所打了电话”。`stream` 与 `self` 在自由运行里也交给了 Agent；`author_kind` 是语料构建时按公开资料推断的，没有交给 Agent。
- **`frame.signal`：宿主为何此刻调用 Agent。** `{type, reason, received, window: {from, to}, coverage?, reminders?}`；`type` 为 events（有新输入）或 review（定时整理且窗口内 0 条）。

这三项是演示数据先行定下的形态，契约尚未接纳，见[决策记录](../docs/decisions.md#推迟到后续切片)；回应路径的生命周期、事项的稳定称呼等相关缺口列在[未决问题](../docs/decisions.md#未决问题)。

## 回应组件

[respond.mjs](respond.mjs) 按 `ask.expects` 给出回应控件，各形式共用：数据层（`normalizeAsk`、本页反馈记录 `createResponseStore`，记录先 saved、下一轮整理回放后 acknowledged，不采集查看）、标记层（`responseHTML`、`composerHTML`、`keypadHTML`、`deferHTML`、`scheduleHTML`、`receiptHTML`，每个部件带 `rs-*` 类，可传入形式自己的类名）、事件层（`bindResponses`，一个委托监听处理点按与键盘）；`mountResponse` 把三层合成一个可用控件，配 [respond.css](respond.css) 的默认样式（只在 `.rs-skin` 内生效）。D 手机首页已改为用它，外观与行为不变。[回应组件页](forms/respond.html)逐类演示，并列出与 `event.feedback` 同形的反馈记录。

截图与报错检查用 `node scripts/shoot-forms.mjs`（本机 Chrome 无头运行，见[工作环境说明](../docs/development.md#体验站构建与发布)）；`--only all --check all-sync` 检查合页的同步切帧。

## 十二种形式

同一份回放、同一套回应组件，按场景分工：首页类只承载最急的少数问题，空间类在电脑前处理评审与二选一，时间类处理期限与推后，复盘类不承载作答、只标出问题的开闭与份额去向。每种形式现在怎样工作、怎样验证、还差什么，记在右列的打磨记录里；为什么这样分工见 [CONCEPTS.md](forms/CONCEPTS.md#真实数据下的问题清单)。

| 形式 | 场景 | 承载的回应 | 入口 | 打磨记录 |
| --- | --- | --- | --- | --- |
| 原版树图 | 在电脑前掌握两周局面，顺手处理工作评审；换轮时格子按离场、移位、进场挪到新面积，作答时格子原地收成回执、面积不让，下一轮整理读到了才让出份额；直接打开讲一遍约 10 秒 | approve（格子里直接批准或要求修改）；其余在详情卡里作答；悬停格子看概要，点击格子弹出、详情卡盖在右栏上 | [index.html?frame=26](./index.html?frame=26) | [spatial.md](forms/polish/spatial.md)、[tree-motion.md](forms/polish/tree-motion.md) |
| A 空间排布 | 桌前，生活急事要当场二选一；作答时卡原地收成回执，下一轮整理读到了，纸片才让出份额、桌面空出一块，回执飞到它的纸片上 | choose、稍后；也能批准、定时间、回一句；悬停纸片看概要，点击展开详情并在卡里作答 | [?variant=a&frame=26](./index.html?variant=a&frame=26) | [spatial.md](forms/polish/spatial.md)、[a-motion.md](forms/polish/a-motion.md) |
| B 时间展开 | 期限落在此刻之后的哪里，谁先到；换轮时此刻之后的一切朝此刻线流，最近的期限撞上来，答掉它，最近的期限才往后退；直接打开讲一遍约 7.5 秒 | schedule、choose，任何事项都可稍后提醒；回应面板原地收成回执，下一轮读到了才让出份额；悬停看概要，点击展开详情，在右栏作答 | [?variant=b&frame=26](./index.html?variant=b&frame=26) | [temporal.md](forms/polish/temporal.md)、[b-motion.md](forms/polish/b-motion.md) |
| C 流动形态 | 可以推后的事沉下去，到点浮起；换轮按涌入、长缩、沉浮、落定四段走，直接打开时讲一遍：那件事沉了几轮、到点浮起 | defer；作答时控件原地收成回执，下一轮整理读到才沉；其余用回应组件；悬停液滴看概要，点击展开详情 | [?variant=c&frame=25](./index.html?variant=c&frame=25) | [temporal.md](forms/polish/temporal.md)、[c-motion.md](forms/polish/c-motion.md) |
| D 手机首页 | 离开半天回来，先答最急的 3 件；作答时卡原地收成回执，下一轮整理先确认回执、再带着让出的份额沉到进行中 | approve、choose 一键；confirm、reply、schedule、defer；轻点卡从卡长出详情，长按看概要，左滑知道了 | [?variant=d&frame=26](./index.html?variant=d&frame=26) | [home.md](forms/polish/home.md)、[home-motion.md](forms/polish/home-motion.md) |
| 腕上一瞥 | 抬腕两秒：要不要现在掏手机；换轮时刻度重分、新要你回的闪一下、数字落定 | confirm 与两项的 choose；其余转到手机；悬停刻度或事项名看概要，点击展开详情 | [forms/watch.html](forms/watch.html?frame=26) | [home.md](forms/polish/home.md)、[watch-motion.md](forms/polish/watch-motion.md) |
| 两周小倍数 | 复盘两周注意力怎样移动；直接打开放一遍约 24 秒，看出它是成块挪的 | 不承载作答；黑点 = 一个开着的问题，展开后仍开着的问题链到同一帧的 D；悬停一帧或一格看概要，点击展开详情 | [forms/multiples.html](forms/multiples.html?frame=26) | [review-a.md](forms/polish/review-a.md)、[multiples-motion.md](forms/polish/multiples-motion.md) |
| 身份线 | 追一件事的来龙去脉：改名、撤下、并入 | 不承载作答；标出问题的开与闭 | [sketches/lineage.html](forms/sketches/lineage.html) | [review-a.md](forms/polish/review-a.md) |
| 回应时序 | 我欠了谁什么回应，开了多久 | 不承载作答；所有类型的开闭与期限；还开着的问题旁“去回答 →”链到同一帧的 D | [sketches/timing.html](forms/sketches/timing.html) | [timing-motion.md](forms/polish/timing-motion.md) |
| 来源矩阵 | 某件事背后是谁在推动 | 不承载作答 | [sketches/provenance.html](forms/sketches/provenance.html) | [review-b.md](forms/polish/review-b.md) |
| 让位图 | 一件事变大，份额从谁那里来；直接打开时讲一遍三拍：从哪来、问题关上、退回的份额到哪去 | 不承载作答；作答之后份额让给了谁；悬停色块看概要，点击展开详情，开着的问题链到同一帧的 D | [sketches/yield.html](forms/sketches/yield.html) | [review-b.md](forms/polish/review-b.md)、[yield-motion.md](forms/polish/yield-motion.md) |
| 批次记谱 | 每一轮整理读了多少、丢了多少、动了几件 | 不承载作答；每轮登记、失效与答掉的问题；侧栏问题旁的“去回答 →”链到同一帧的 D | [sketches/notation.html](forms/sketches/notation.html) | [notation-motion.md](forms/polish/notation-motion.md) |
| 变形 | 收到多少不等于给多少：同一批事项留在原位，面积从收到的条数变成份额；直接打开讲一遍约 7 秒：收到最多的 master CI 141 条只给 6 份，主水管 29 条给了 24 份 | 不承载作答；朱红只标此刻开着的问题；悬停圆看概要，点击展开详情，开着的问题旁“去回答 →”链到同一帧的 D | [sketches/morph.html](forms/sketches/morph.html) | [morph-motion.md](forms/polish/morph-motion.md) |
| 峰值保持 | 离开期间升起又落下、回来时已经看不出来的事；峰值一直停着，直到你按“已阅”；直接打开讲一遍约 11 秒：你不在、此刻看不出来、已阅 | 不承载作答；“已阅”只清本页的峰值，可撤回；悬停一根看概要，点击展开，此刻开着的问题旁的“去回答 →”链到同一帧的 D | [sketches/peak.html](forms/sketches/peak.html) | [peak-motion.md](forms/polish/peak-motion.md) |
| 整理脉冲（动画） | 官网首屏：一轮整理演成 4.25 秒的一次脉冲 | 不承载作答；详情里链到 D 作答；朱红只标新登记的问题、你的回应与答掉的记号 | [motion/pulse.html](forms/motion/pulse.html) | [story.md](forms/motion/pulse/story.md) |
| 份额拨盘（动画） | 第一次看 Fold 的人，20 秒：64 份是怎样的硬约束，满了谁让位 | 不承载作答；详情里链到 D 作答；游标只指要紧的问题 | [motion/dial.html](forms/motion/dial.html) | [story.md](forms/motion/dial/story.md) |

表末两个动画是第三轮给官网用的概念动画，放在 `forms/motion/`，不算在十二种里。它们和上面的形式一样只读同一份回放（frames、批次、问题与反馈），不另造数据、不改契约；画面分两层，概念层只在渲染层炫，信息层的数字与面板都能在各自的 data.json 里找到出处（[整理脉冲](forms/motion/pulse/data.json)、[份额拨盘](forms/motion/dial/data.json)）。概念卡见 [CONCEPTS.md](forms/CONCEPTS.md#第三轮概念动画)。

整理脉冲默认从 `f00` 自动连播并首尾相接，`?frame=` 演一遍那一轮再停住，`?from=` 从那一轮起连播（官网首屏可用 `?from=19`）；悬停（或 Tab 到）枝条看概要，点击展开详情，两者都让本轮停在当前时刻，详情里的问题链到同一帧的 D 去回答（见 [story.md](forms/motion/pulse/story.md) 末节“交互”）；参考拆解、数字与故事见 [spec.md](forms/motion/pulse/spec.md)、[data.json](forms/motion/pulse/data.json)、[story.md](forms/motion/pulse/story.md)。份额拨盘默认循环 20 秒三拍，空格连播全部轮次，←/→ 逐帧并停住，`?frame=` 直接停在那帧；悬停（或 Tab 到）扇区看概要，点击展开详情，两者都让播放停在当前轮，详情里的问题链到同一帧的 D 去回答（见 [story.md](forms/motion/dial/story.md) 末节“交互”）。

入口里的 `frame` 是帧序号，composite 的 29 帧从 `f00`（空状态）到 `f28`；复盘类不带 `frame` 时打开数据集自己的默认帧。[形式画廊](forms/index.html)把它们并排放在一起，[回应组件页](forms/respond.html)逐类演示六种回应控件。

[全部原型合页](./all.html)把上面十二种、回应组件页和第一轮撤下的八个形式按顺序嵌在一个长页面里，每节是实时运行的页面：顶栏选一帧，各页通过 `postMessage` 原地切到那一帧（[embed.mjs](embed.mjs)；页面自己往前走不会被拉回），切数据集时整页重载；离视野远的页面会卸载，滚回来时按所选帧重新载入。原版与 A/B/C/D 在合页里带 `?embed=1`，只隐藏方案切换栏；形式页带 `?card=0` 收起概念卡。

第一轮撤下的八个形式（晨间朗读、进程条架、头版、小票、环境球、到期时刻表、出处栏、对话线程）已从 `codex/form-explorations` 恢复为可运行页面，概念卡在 `catalog.mjs` 的 `withdrawn` 里。它们只做了能在 composite 与 story 下无报错运行的最小适配（问题的期待改读 `ask.meanings`，来源作者从事件补出，对话线程的“本人”改用数据集人物与 `self` 事件），没有打磨，也没有按真实数据重新设计；为什么撤下见 [CONCEPTS.md](forms/CONCEPTS.md#第一轮结论)。

### 共同操作

- 原版与 A/B/C/D 共用底栏：在同一时刻切换方案，保留层级与选中的事项；「回放片段」直达各章，「状态」打开数据核对区（完整状态 JSON、原始输入、声明与回执、变化对比）。←/→ 逐帧，空格播放，Alt+←/→ 切换方案。
- 腕上一瞥、小倍数与五张复盘图的页头各有帧导航：←/→ 逐帧，空格播放，当前帧写进地址栏 `frame=`；让位图、来源矩阵与批次记谱的侧栏底部链到同一帧的其他形式。
- 批次记谱直接打开（不带 `frame=`）时停在最后一帧，先演 12 秒的开场：读、丢、动三拍同时作用在全部行上，任意键或点一下跳到终态，R 或顶栏“重演”从头演到此刻；嵌入与带 `frame=` 的链接不演。换帧时新的一行演 0.9 秒的缩短版。悬停一行看这一轮的账，悬停记号看这一件，点击展开到侧栏，与两个动画共用 `forms/motion/ix.mjs`（见 [notation-motion.md](forms/polish/notation-motion.md)）。
- 回应时序直接打开（不带 `frame=`）时先讲一遍约 24 秒：开得最久的“母亲九月住哪？”从登记、等 19 轮到别人先开口，落在最后一帧；任意键或点一下跳到终态，顶栏“▶ 讲一遍”重讲；嵌入与带 `frame=` 的链接不讲。之后 ▶ 连播、←/→ 逐帧都按同一节拍走：此刻线缓出，批次刻度上硬切。悬停一条时序线看概要，点击弹出 8 px、引线出到详情卡，右栏切到“这一件”，同样共用 `forms/motion/ix.mjs`（见 [timing-motion.md](forms/polish/timing-motion.md)）。
- C 流动形态直接打开（不带 `frame=`、不是从别处链进来）时先讲一遍约 20 秒：猫看病那件（story 是费用）沉下去、在水下等 9 轮（story 13 轮）、到点带着新消息浮起，落在浮起那一帧；任意键或点一下跳到终态，顶栏“▶ 讲一遍”重讲；嵌入、合页与带 `frame=` 的链接不讲。换轮按涌入（一粒一条输入）、长缩（份额加留白始终是 64）、沉浮、数字落定四段走。悬停一滴看概要、其余压暗，点击沿它自己的方向弹出 8 px、引线出到详情卡，右栏切到“这一件”，共用 `forms/motion/ix.mjs`；作答时右栏控件原地收成回执，液滴等下一轮整理读到才沉（见 [c-motion.md](forms/polish/c-motion.md)）。
- 变形直接打开（不带 `frame=`、不是从别处链进来）时先讲一遍约 7 秒，停在 f26（story 是 f15）：圆按收到的条数长出来，再原地变成份额，最后圈出收到最多与份额最多的两件；任意键或点一下跳到终态，顶栏“▶ 讲一遍”重讲；嵌入、合页与带 `frame=` 的链接不讲，默认停在最后一帧。顶栏“收到/给出”或 M 在两态之间原地变形 1 秒，所有圆同一条缓动、同起同落，数字落地才换。悬停一个圆看概要，点击沿它自己的方向弹出 8 px、引线出到详情卡，右栏切到“这一件”，共用 `forms/motion/ix.mjs`（见 [morph-motion.md](forms/polish/morph-motion.md)）。
- 本页作答只存在浏览器内存里：按下即“已保存”，推进到下一轮整理后显示“已收到”，随时可撤回；不写回演示数据，也不调用模型。
- 原版与 A/B/C/D 都保留未分配份额：原版与 A 用面积、B 用带宽、C 用液滴面积与 64 格预算带、D 用先后与字号表达份额，精确份数在详情里。
- `prefers-reduced-motion` 时切帧与作答直接到终态。

C 用自写的 WebGL2 着色器画液滴，不再使用随原型保存的 [Three.js 本地模块](vendor/three/README.md)。第一版四种视觉表达的实验假设、表达边界和待评审问题见 [EXPLORATIONS.md](EXPLORATIONS.md)，其中的细节描述早于打磨，以打磨记录为准。

### 形式从哪里来

第一轮在 A/B/C/D 之外做了十个形式，多数把状态搬进现成载体（手表、广播、小票、报纸、时刻表、聊天窗），评审后留下两周小倍数；腕上一瞥是用户后来决定保留的。第二轮只为状态自身的结构发明画法：身份线、回应时序、来源矩阵、让位图、批次记谱起初是单帧草图，现在都已做成可逐帧的完整版。两轮结论、全部概念卡与做形式时发现状态里缺的信息见 [CONCEPTS.md](forms/CONCEPTS.md)，灵感来源见 [INSPIRATION.md](forms/INSPIRATION.md)。

## 原版操作（手写情境）

下面的帧号与份额按 `?data=story` 的林苒两周；composite 同样从空状态开始，操作相同。

- 从真正的空状态开始：第一帧为 r0/e0，没有输入与提交。接着只纳入一件事，再补入生活背景，份额依次为 0 → 6 → 18 → 49；初始阶段有独立跳转入口。
- 播放、逐帧前后跳转，或拖动时间轴到任意时刻。两次批处理之间业务状态保持，时间投影继续流逝。
- 切换状态时，同一条目会连续移动和缩放；合并的条目会汇到一起，下钻会从父项展开细节，返回时再收回。可用「重播过渡」再看一次，打开「慢动作」观察注意力怎样转移。
- 左侧显示这一帧的原始消息及采用、重复、噪音、暂缓的理由。
- 点击 Pinboard 条目查看详情；有子项时点击箭头进入独立预算的下一层。
- 右侧可以在排版详情与原始 JSON 之间切换。顶部「完整 state」始终可查看整份状态。
- 点击「对比状态」，选择基线与当前帧，查看同尺度的两个 Pinboard 和字段变化。
- 空格播放／暂停，左右方向键逐帧，Esc 返回上层。URL 保留帧、层级和对比基线。

两个动画演示入口：

- [两张账单合成一张](./index.html?data=story&frame=5)：向前一步看归并，再退一步看原来的两条线索展开。倒放是在查看合并前的历史，不代表生产系统有 split API。
- [导出发布的两级细节](./index.html?data=story&frame=3)：进入「v0.8导出：模板编辑待定」，再进入「旧机操作验证与回滚演练」，用返回或 Esc 逐层收回。

人物和私人消息为演示创作，公共事实的官方来源见 [STORY.md](STORY.md)。故事中的 Agent 决策已预先编排，不能据此宣称真实 Agent 或模型达到相同判断质量。

## 评审留白

通过实际播放继续判断：取舍是否自然，时间关系是否清楚，动画中的注意力转移是否可读，哪里需要反复查 JSON，以及噪音是否影响阅读。十二种形式都没有选定；公开体验不代表已选定产品方案，也不代表真实 Agent 判断质量或 Fold CLI 已通过验收。默认演示数据含化名改写的真实公开文本，2026-10-15 用户决定照现状公开，来源与许可见 [SOURCES.md](data/composite/SOURCES.md#公开与许可)。
