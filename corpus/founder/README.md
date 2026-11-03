# 创始人语料：陆晨的两周

状态：2026-11-03 流水线已就绪，节拍表与消息还没写。内容写好后在这里补规模、方法与检查结果；设计见[大纲](OUTLINE.md)。

## 流水线

[scripts/founder_corpus.py](../../scripts/founder_corpus.py) 由节拍表 `beats.json`（事实与标注的唯一来源，格式见[大纲第 7 节](OUTLINE.md#7-数据形态)）确定性地生成其余文件，不调用模型。噪音指标与标注复用 `build_corpus.py` 与 `family_stream.py` 的函数。

| 步 | 读 | 写 | 入库 |
| --- | --- | --- | --- |
| render | `beats.json` | `messages.json`（成品，一行一条）与 `BEATS.md`（中文可读版） | 是 |
| build | `messages.json` | `frames.json`：与 composite 同形，f01–f28，从 9/7 0:00（Asia/Shanghai）起每 12 小时一帧；演示数据的空状态 f00 由 `build_demo_data.py` 按 f01 的窗口起点补上 | 否，本机重建 |
| labels | `beats.json`、`frames.json` | `labels.json` 的 `authored` 一节（与 composite 家庭流的作者标注同形，范围是全部五条流）与 `LABELS.md` | 是 |
| noise | `frames.json` | `noise.json` 与 `NOISE.md`：指标与第 5 节的目标并排，另列各渠道的条数、本人与应忽略 | 是 |
| check | 以上全部 | 不写文件；任何一条不过就以非零退出 | — |

```sh
.venv/bin/python scripts/founder_corpus.py all        # 依次 render、build、labels、noise、check
.venv/bin/python scripts/founder_corpus.py check      # 只检查，并打印各渠道条数与第 5 节对照
.venv/bin/python scripts/founder_corpus.py all --beats scripts/fixtures/founder-mini/beats.json --root .local/founder-mini   # 内容写好前用小样例跑通
.venv/bin/python scripts/founder_corpus.py selftest   # 小样例跑完各步，再逐条注入错误，确认 check 每条规则都会报；make test 会运行它
```

[小样例](../../scripts/fixtures/founder-mini/beats.json)有 3 件事、10 拍、2 组噪音，含一条通话记录与一笔转账，工作侧与生活侧 33 : 11，可以当节拍表的格式样板。

### 事件

字段只取大纲第 7 节列出的：`id` 是 `fd-` 加 `authored:<拍>.<序>` 的 sha1 前 8 位，序是消息在拍里的先后（从 1 起，`dup_of` 用同样的写法）；`stream`、`project` 来自渠道；`side` 由流定，subscription 的渠道要写 `side`；`kind` 省略时为 `message`。通话与转账带结构化的 `call: {direction, peer, seconds}` 与 `transfer: {direction, peer, amount}`，没写正文时按默认模板生成；节拍表的 `templates` 放通知类的模板，消息用 `template` 与 `params` 引用。

节拍表在第 7 节之外还要写：顶层的 `title`、`window`（`start`、`end`、`timezone`）、`languages`（含 `zh` 时低信息量另认中文的附和与表情代码）、`persona`（含 `language`，评测把它交给 Agent）与 `streams`（各流的说明）；渠道的 `row`，指明计入第 5 节渠道表的哪一行；事项的 `title`（20 字以内）与 `short`（6 字以内）。消息可另标 `fragment`（半截话），供噪音画像计数。

### 检查

`check` 对渲染结果、`messages.json` 与 `frames.json` 都查一遍，按规则报出：

| 规则 | 内容 |
| --- | --- |
| refs | 引用的人、渠道、事项、问题与 `dup_of` 都存在，拍的编号不重复 |
| stale | `messages.json`、`frames.json` 与节拍表的渲染结果一致 |
| duplicate_id、order、window | 编号不重复；按时间排序；都在窗口内，且落在所在帧的窗口里 |
| stream、fields | 流是五条之一；第 7 节的必填字段齐全、没有多余字段，`kind` 在列表里，通话与转账带结构化字段 |
| banned | 第 6 节不要用的词：扫事项标签与短名、问法、短问法与选项、旁白（gist、misfit、note、噪音话题），不扫人物台词 |
| names | 人名不与手写情境（`prototype/STORY.md` 与它的演示数据）重名、不用那边的姓，不与 composite 的人物和家庭流重名 |
| short、length | 短问法不超过 16 字；事项标签不超过 20 字、短名不超过 6 字 |
| ratio | 工作侧（work、community 与 side 为 work 的订阅）比生活侧（family、life 与 side 为 life 的订阅）在 2.7–3.3 之间 |

## 下游

- **评测。** `scripts/eval_judgment.py --free-run --corpus corpus/founder/frames.json` 把 `persona.language` 与 `streams` 原样交给 Agent，不加 composite 的瑞典语说明；与 `labels.json` 的 `authored` 一节对照，见[工作环境说明](../../docs/development.md#真实语料)。
- **演示数据。** `scripts/build_demo_data.py founder` 已按数据集分开设置（全部流保留非消息的 `kind`、透传结构化的通话与转账、收款记为来源处的动作），但还没有运行可以导入；`prototype/data/select.mjs` 也还没登记 founder。
