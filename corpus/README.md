# 真实语料：第二个判断基准

状态：评测原料与方法说明。语料来自公开渠道，原文只在本机重建；仓库里保存来源调查、抓取与构建脚本、输入 ID 清单、噪音统计和弱标注。它不改变[信息契约](../docs/information-contract.md)。

[原型情境](../prototype/data/story/scenario.mjs)的 37 帧、112 条输入由作者手写：每条都有信息量，没有重复、机器人、半截话或互相矛盾，时间也整齐。真实世界里替一个人工作的 Agent 收到的是另一种东西：机器人通知、“谢谢”和“有进展吗”、重复报告、迟到的回复、几个渠道对同一件事的不同说法，以及其中少数真正要紧的事。这里收集一份这样的输入，不清洗，量化它和手写情境差在哪里，并用这个人后来实际做了什么推出弱标注。

手写情境继续保留：它有逐帧的完整批次，适合 teacher-forced 对比；真实语料是第二个基准，检验 Agent 在噪音里的取舍。只有工作还不够像一个人的收件箱，[composite](#混合人物composite) 把 curl-bagder 的工作流与几位真实的人公开的社区、生活与订阅数据拼成一个化名人物的两周，再加上作者编写的家庭往来。

## 来源调查与选择

**选择标准：** 同一个真实的人、同一段两周、多个来源，身份与时间线都是真的；窗口内输入 300 条以上；噪音至少五种；能找到这个人后来实际做了什么，作为弱金标签；许可允许存原文摘录，否则只存 ID 与抓取脚本。

开源维护者的候选统一调查 2026-08-03 至 08-16 这两周，数字是调查时用公开 API 粗数的量级；选定来源的精确统计见各自的噪音报告。

| 候选 | 同一个人 | 两周输入量级 | 渠道 | 噪音类型 | 后续行为（弱标签） | 访问与许可 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| curl：Daniel Stenberg（bagder） | 创始人兼首席维护者，几乎所有线程都经过他 | GitHub 约 760 条（新开 136、评论 352、行内评审 274），另有评审、他触发的 CI 失败约 150 次、邮件列表约 20 封、Mastodon 上回复或提到他的约 350 条、博客评论数条 | GitHub、CI、三个邮件列表、Mastodon、博客 | 评审机器人、依赖更新机器人、自动化测试账号、CI 失败、AI 生成的低质量 PR、致谢与附和、被替代的 PR、表情与单句社交回复 | 评论、评审、关闭（含以提交关闭）、打标签、里程碑；邮件列表、Mastodon、博客上的回复；团队其他维护者的同类行动 | GitHub API（登录）、curl.se 存档（robots 允许）、Mastodon 公开 API、WordPress REST；用户内容版权归作者 | **主来源** |
| tmux：Nicholas Marriott（nicm） | 单一维护者 | GitHub 约 310 条（新开 48、评论 261），其中锁帖机器人约 70 条 | 只有 GitHub；邮件列表在 Google Groups，没有公开 API | 机器人、重复报告、致谢 | 回复、关闭、提交修复 | GitHub API | 量刚过线、单一渠道，不选 |
| FastAPI：Sebastián Ramírez（tiangolo） | 创始人，但分诊多由团队成员完成 | GitHub 约 150 条，约一半是机器人 | GitHub | 预览、基准与提交检查机器人，翻译 PR，刷屏 | 他本人两周约 13 次行动 | GitHub API | 量不够，“同一个人”被团队稀释，不选 |
| Apache Kafka 开发者邮件列表 | 以列表为中心，没有单一收件人 | 每月约 430 封，两周约 200 封，近半是 JIRA 通知 | dev@ 列表（JIRA、GitHub 通知另有列表） | JIRA 机器人、投票“+1”、重复讨论 | 投票、回复、提交 | Ponymail 公开 API | 替谁工作不清晰，不选；可作日后的列表型对照 |
| Linux 内核某子系统维护者 | 维护者本人 | 每两周数千封 | lore.kernel.org 邮件存档 | kernel test robot、syzbot、patchwork 机器人、补丁版本迭代 | “Applied, thanks”、Acked-by、Reviewed-by | lore.kernel.org 对脚本客户端返回 403，连 robots.txt 也拒绝 | 噪音最真实，但站点拒绝自动抓取，不选 |
| Enron 邮件语料中的一位员工 | 邮箱主人 | 选中邮箱的两周 754 封（来信 504、本人发出 250） | 一个企业邮箱：工作、内部公告、系统通知、新闻转发与私人往来 | 群发公告、系统通知、长转发链、整段引用、新闻剪报、抄送 | 已发送里的回复与转发；来信最后落在已删除还是归档文件夹 | FERC 调查公开，CMU 发布 2015-05-07 版 | **对照来源**：商务与私人混杂，与手写情境的人物更接近；年代久远 |

**为什么选 curl。** 只有它同时满足：一个真实的人处在多个渠道的交汇处（GitHub、CI、邮件列表、Mastodon、博客），两周输入过千条，噪音种类最全，而且这个人的后续行为大多公开可查——回复了什么、关闭了什么、合并了什么、在哪个渠道继续讨论。它的局限也清楚：几乎全是工作事务，私人生活只以社交回复的形式出现；GitHub 通知是按公开事件重建的近似，不是他真实的收件箱。Enron 对照来源补上“商务与私人混杂”的一面，并且它的弱标签来自邮箱主人亲手的处置（删除、归档、回复）。

**Enron 邮箱怎样选。** 扫描 CMU 语料全部 150 个邮箱，按两周窗口统计收件箱、已删除、归档与已发送的封数，只看 Outlook 时代（2000 年 9 月以后）同时有足量收件、删除与发送的组合。`steffes-j` 在 2001-10-22 至 11-04 收到 504 封、删除 322 封、归档 98 封、发出 249 封，是唯一来信超过 500 且三种处置都充足的组合。

## 主来源：curl-bagder

| 项 | 内容 |
| --- | --- |
| 人 | Daniel Stenberg，curl 创始人与首席维护者；GitHub `bagder`，Mastodon `@bagder@mastodon.social`。只使用公开身份与公开内容。 |
| 窗口 | 2026-08-03 00:00 至 08-17 00:00（Europe/Stockholm），恰在 8.22.0 功能冻结前后；抓取范围前延 1 天、后延 30 天，窗口外的记录只作上下文和弱标注的证据。 |
| GitHub | `curl/curl`、`curl/curl-www`、`curl/everything-curl` 的新 issue/PR、评论、评审（行内评论并入所属评审，与邮件通知的粒度一致）、讨论与回复、关闭/重开/合并、请求他评审、发布；他触发的 GitHub Actions 失败运行。 |
| 邮件列表 | curl.se 上的 curl-library、curl-users、curl-distros 存档。 |
| Mastodon | 他自己的帖子，以及回复他或提到他的公开帖子（从他各帖的上下文取得）。 |
| 博客 | daniel.haxx.se/blog 的公开评论。 |
| 不在其中 | 私信与私人邮件、私下提交的安全报告、IRC、他线程之外提到他的 Mastodon 帖子（需要登录才能查）、PR 推送通知、他关注的其他仓库。 |

**这是近似。** GitHub 关注者通知按公开事件重建，他的通知设置、过滤规则和已读状态都不可见；Mastodon 只覆盖他自己帖子下的对话；抓到的是当前版本，发出后被编辑的内容与当时到达的不同（帧里标 `edited`），被删除的找不回。

## 对照来源：enron-steffes-j

| 项 | 内容 |
| --- | --- |
| 人 | CMU Enron 语料（2015-05-07 版）中的邮箱 `steffes-j`（James D. Steffes），从往来邮件看属于政府事务部门。只用语料中的内容。 |
| 窗口 | 2001-10-22 00:00 至 11-05 00:00（America/Chicago），正是公司危机公开化的两周；抓取范围前延 1 天、后延 14 天。 |
| 输入 | 收件箱、已删除与各归档文件夹里的来信，以及他发出的邮件（作为本人发言）。同一 Message-ID 在多个文件夹里的副本是导出格式造成的，合为一条并记副本数。 |
| 不暴露结局 | 文件夹名只用于弱标注，不进入帧；事件 ID 用 Message-ID 的摘要，不用含文件夹名的文件路径。 |
| 局限 | 2001 年的企业邮件，没有机器人通知与社交媒体；文件夹是事后整理的结果（可能几周后才清理），删除不等于当时没读。 |

## 混合人物：composite

| 项 | 内容 |
| --- | --- |
| 人 | 化名人物 Jonas Berglund，斯德哥尔摩，开源传输库 skarv 的维护者；由多位真实的人的公开数据拼成（工作 1 位、论坛 1 位、问答 34 位提问者，另有订阅的作者），家人与朋友由作者编写，设定见 [MIX.md](composite/MIX.md#人物)。 |
| 窗口 | 与 curl-bagder 相同：2026-08-03 至 08-17（Europe/Stockholm），28 帧、3217 条。 |
| 各流 | 工作 1676（curl-bagder 全部输入）、社区 738（iNaturalist 公开论坛）、生活 326（Stack Exchange 八个生活站点的 34 个问题）、订阅 89（Substack newsletter、Enron 营销群发、SMHI 天气提醒）、家庭 388（作者编写的瑞典语家人、朋友、邻居往来与家务通知）。工作占 52%。 |
| 改写 | 项目、仓库、账号、人名、邮件列表、域名与各类编号按一张本机化名表一致替换，只用规则，不用模型；每条输入带原始记录 ID 的加盐摘要 `origin`。化名不是匿名，正文仍可被搜索到。 |
| 跨流的事 | 6 件，挑选时间或话题真实重合的线程得到，不手写。 |
| 家庭流 | 2026-10-15 用户决定：参考真实数据仿写，不用真实内容，形式不限于邮件。人物、事件与文字都是原创，Enron 私人往来只作语气参考，与它没有共同的专名、没有 8 词以上的重合；节拍表、成品与标注入库，见 [family/README.md](composite/family/README.md)。 |
| 用到哪里 | 第一次自由运行见[自由运行评测](../docs/evaluations/free-run-composite-2026-10-15.md)，那时还没有家庭流；运行结果经人工打磨成原型的默认演示数据，见 [POLISH.md](../prototype/data/composite/POLISH.md)。含家庭流的自由运行尚未重跑。 |

## 许可与入库范围

GitHub 上的 issue 与评论、Mastodon 帖子、邮件列表与博客评论的版权归各自作者，GitHub 服务条款没有授予第三方再发布这些内容的许可。Enron 语料由 FERC 公开、广泛用于研究，但包含大量真实个人信息。两种来源都按同样方式处理：

| 入库 | 只在本机（已在 `.gitignore` 中） |
| --- | --- |
| 本文件、各来源的噪音报告与弱标注说明 | `corpus/<source>/raw/`：抓取的原文 JSON |
| `ids.json`：每条输入的 ID、帧、类型、时间、作者类别、线程、来源 URL、原文长度与摘要哈希 | `corpus/<source>/frames.json`：带原文的帧序列 |
| `noise.json`、`labels.json`：只含统计、ID 与依据 | `.local/cache/`：Enron 压缩包缓存 |
| composite 的 `ids.json` 只含化名 ID 与 `origin`，不含来源 URL | `.local/composite/`：化名表、随机盐与挑选，营销邮件缓存 |

例外是原型的演示数据：[prototype/data/composite/scenario.mjs](../prototype/data/composite/scenario.mjs) 收入了截到 500 字的化名改写正文，随本分支入库，各流的引用长度与公开前要解决的事见 [SOURCES.md](../prototype/data/composite/SOURCES.md)。它能否随站点公开由用户决定，决定之前不运行 `npm run deploy`。

composite 另用到 Stack Exchange（CC BY-SA 4.0）、SMHI 观测（CC BY 4.0）、iNaturalist 论坛与 Substack 的公开文章（版权归作者），处理方式相同；许可逐项列在 [MIX.md](composite/MIX.md#许可与入库)。文档只引用极短的通用片段（如“Thanks!”）说明噪音形态，不转录成段原文。抓取时把电话号码样式替换为 `[phone]` 并计数，不保存邮箱地址以外的个人联系方式；Enron 的邮箱地址保留，用于识别本人与回复关系。只抓公开数据，遵守 robots.txt，顺序请求并限速。

## 怎样重建

需要已登录的 `gh`、Python 3.11+ 与 Node.js（只用于导出原型情境作对比），只用标准库：

```sh
.venv/bin/python scripts/fetch_corpus.py curl-bagder       # 一千余次 GitHub 请求与数百次网页请求，二三十分钟
.venv/bin/python scripts/build_corpus.py all curl-bagder   # frames.json，对照 ids.json，noise.json
.venv/bin/python scripts/label_corpus.py curl-bagder       # labels.json；--audit 30 另打印抽样供人工核对
.venv/bin/python scripts/fetch_corpus.py enron-steffes-j   # 首次下载约 423 MB 的 CMU 压缩包到 .local/cache/enron/
.venv/bin/python scripts/build_corpus.py all enron-steffes-j
.venv/bin/python scripts/label_corpus.py enron-steffes-j
.venv/bin/python scripts/fetch_corpus.py composite         # 论坛、问答、newsletter、天气，数百次请求
.venv/bin/python scripts/compose_corpus.py build           # 需要上面两个来源的 raw/ 与本机化名表
.venv/bin/python scripts/compose_corpus.py labels
.venv/bin/python scripts/compose_corpus.py noise
.venv/bin/python scripts/compose_corpus.py family          # 追加作者编写的家庭流，只需现有 frames.json 与入库的节拍表
```

[scripts/fetch_corpus.py](../scripts/fetch_corpus.py) 按来源时区解释 `--start/--end`，抓取范围是窗口前 1 天到窗口后 `--followup-days` 天；`--only github,lists` 只重抓部分流，`raw/meta.json` 记录每个流的条数、抓取时间与替换的电话号码数。CMU 压缩包本次下载的 SHA-256 为 `b3da1b3fe0369ec3140bb4fbce94702c33b7da810ec15d718b3fadf5cd748ca7`。

[scripts/build_corpus.py](../scripts/build_corpus.py) 的 `frames` 会把结果与入库的 `ids.json` 对照：原文被删除、编辑或换帧时列出差异，不悄悄改写清单；确认接受新结果时加 `--write-ids`。主来源的 GitHub 部分相隔约半小时重抓一次，重建出的 1676 条输入的 ID、帧与原文哈希不变。`--frame-hours` 改变切帧粒度（默认 12 小时），帧号会随之改变。

## 帧格式与原型情境的关系

`frames.json` 与 `node scripts/export-scenario.mjs` 的导出同形：顶层有 `persona`、`startAt`、`endAt`、`timeZone` 与 `frames`；每帧有 `id`、`at`、`events`、`batch` 与 `signal`。帧按来源时区的钟面时间切分，每 12 小时一帧，`at` 是这段时间的结束时刻，`signal` 写明窗口、原因与条数。帧里的输入不清洗、不去重、不删机器人，按到达时间排序。

| 字段 | 手写情境 | 真实语料 |
| --- | --- | --- |
| `events[].id / channel / from / at / text` | 有 | 有；`id` 是来源的稳定 ID，`text` 是原文，超过 2000 字截断并在 `text_length` 记原长、标 `truncated` |
| `subject / thread / url / kind / author_kind` | 无 | 有：通知标题（如 `Re: [curl/curl] … (PR #22513)`）、所属线程、原始链接、输入类型、`self / human / bot / automation` |
| 模板文字 | 无 | 状态变化、CI 失败与空评审没有正文，按 GitHub 通知的写法生成一句，标 `text_origin: template` |
| `reply_to / edited / minimized` | 无 | 回复关系、发出后被编辑过、被 GitHub 折叠 |
| `disposition / why / relatedIds` | 作者的处置答案 | 无；弱标注另存 |
| `batch` | 作者批次 | `null`：没有人写过整帧的完整批次 |

本人的发言（评论、评审、关闭、帖子、发出的邮件）也作为输入保留，标 `author_kind: self`，与情境里“用户消息”的地位相同。Mastodon 回复的 `subject` 取被回复帖子的前 80 字，标 `subject_origin: parent_excerpt`。`author_kind` 中的 `automation` 来自公开资料或发件地址的推断，评测时不宜原样交给被测模型。

`scripts/eval_judgment.py --free-run --corpus <frames.json>` 用真实语料做自由运行：Agent 从空状态开始逐帧维护自己的状态，模型看到 `id / channel / from / at / subject / url / text` 与是否本人（`self`），看不到 `author_kind` 等构建标注；结果与弱标注做三项对照，用法见[工作环境说明](../docs/development.md#真实语料)。两种金标签怎样衔接仍是[决策记录](../docs/decisions.md#推迟到后续切片)里的未决问题。

## 弱标注

真实语料没有作者批次，金标签从这个人后来的行为推出：[scripts/label_corpus.py](../scripts/label_corpus.py) 看本人与团队在 7 天内对每个事项做了什么、CI 失败是否很快转绿、邮件是否被删除，给出每帧应被忽略的输入、应合成同一事项的输入，以及事项的弱档位（`engaged / later / delegated / untouched / noise`，每帧另标至多 3 件高档位）。它说明注意力后来去了哪里，不是标准答案；规则、覆盖、抽样核对与局限见各来源的 LABELS.md。

| 来源 | 帧 | 事项标注 | 高档位 | 应被忽略的输入 | 跨事项合并 |
| --- | --- | --- | --- | --- | --- |
| curl-bagder | 28 | 400 | 74 | 1271 条中 409 条（强依据 264） | 47 组 |
| enron-steffes-j | 28（24 帧有标注） | 399 | 36 | 504 封中 337 封（其中删除 322） | 无 |
| composite | 28 | 934 | 76 | 2324 条中 501 条（强依据 354，其中订阅 89） | 47 组，另列跨流的事 6 件 |
| composite 家庭流（作者写定） | 28 | 144 | 20 | 310 条中 185 条 | 1 组；另列问题 19 个 |

## 文件

| 路径 | 内容 |
| --- | --- |
| [scripts/fetch_corpus.py](../scripts/fetch_corpus.py) | 按来源与时间窗抓取原文到 `raw/` |
| [scripts/build_corpus.py](../scripts/build_corpus.py) | 切帧、ID 清单与噪音统计 |
| [curl-bagder/NOISE.md](curl-bagder/NOISE.md) | 主来源的噪音画像，与手写情境并排 |
| [scripts/label_corpus.py](../scripts/label_corpus.py) | 从后续行为推出弱标注 |
| [curl-bagder/LABELS.md](curl-bagder/LABELS.md) | 主来源弱标注的规则、覆盖、抽样核对、局限与评测用法 |
| [enron-steffes-j/NOISE.md](enron-steffes-j/NOISE.md) | 对照来源的噪音画像 |
| [enron-steffes-j/LABELS.md](enron-steffes-j/LABELS.md) | 对照来源弱标注与主来源的差异 |
| [scripts/compose_corpus.py](../scripts/compose_corpus.py) | 拼出混合人物、化名改写、弱标注与噪音统计 |
| [composite/MIX.md](composite/MIX.md) | 混合人物的设定、各流来源与条数、改写规则、跨流的事与许可 |
| [composite/NOISE.md](composite/NOISE.md) | 混合人物的噪音画像，与 curl-bagder、手写情境并排 |
| [composite/LABELS.md](composite/LABELS.md) | 混合人物各流的弱标注规则、覆盖与跨流的事 |
| [composite/family/](composite/family/README.md) | 作者编写的家庭流：节拍表、成品、不可回溯检查与合成方法 |
| [scripts/family_stream.py](../scripts/family_stream.py) | 家庭流的渲染、标注与不可回溯检查 |
| `<source>/ids.json`、`noise.json`、`labels.json` | 可入库的输入清单、统计与弱标注 |
