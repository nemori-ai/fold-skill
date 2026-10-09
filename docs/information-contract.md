# Fold：输入与输出的共同语言

状态：第 4 到第 6 节是首切片要求；第 2、3 节的 Observation 是后续切片，接入第一个非 Agent 渠道时启用。未决问题见[决策记录](decisions.md)。人物与数据均为虚构。

产品动机见[产品方向](product.md)，模块边界见[顶层架构](architecture.md)，估计与执行的数学关系见[形式模型](formal-model.md)，如何教 Agent 使用这些表达见[Skill 设计](skill-design.md)。

## 1. 输入来自世界，输出供多个应用使用

Fold 的输入可以是 Agent 自己做事产生的进展，也可以是它观测到的告警、发现的资料、别人转告的变化或用户主动发来的消息。是否由 Agent 执行，不决定这条信息是否值得被整理。

一轮工作的基本关系是：

```text
原始信息与渠道语义
  → 来源适配器 → 同构的 Observation（后续切片）
  → Agent 结合当前状态、用户背景与反馈进行估计和整理
  → 声明批次 → 内核校验与执行 → 结构化输出
  → 文字简报、Pinboard、推送消费者、输出日志
```

| 边界 | 负责产生什么 | 不由它决定什么 |
| --- | --- | --- |
| 来源适配器 | 有来源、时间、原始内容及渠道解读的规范输入。 | 不把渠道自带的优先级直接当成用户的重要性。 |
| Agent 与 Skill | 跨来源关联、语义估计、摘要与完整取舍，提出声明批次。 | 不把收到信息、意图或推测写成已经完成的行动。 |
| 内核与存储 | 校验并保存合法状态、明确变化及其依据，提供可读取的结构。 | 不以固定公式替 Agent 裁决关注价值。 |
| 下游消费者 | 按约定字段排序、过滤、展示、通知或记录。 | 不从份额自行推导紧急性，也不悄悄改变共享状态。 |

“来源适配器”解决信息表达问题；CLI、MCP、SDK 的调用适配器解决如何调用 Fold 的问题。两者是不同层的职责。

首切片的状态声明由 Agent 提交，也接受用户保存批注。声明可以带 `sources` 附件记录来源，只做必要的结构检查，不核验来源事实，也不据此自动分配份额。

## 2. 规范输入保留什么（后续切片）

称一份规范输入为 `Observation`：**某个来源在某时提供了什么内容，以及该渠道怎样解释这些内容。** 它不是世界真相的认证，也不是已经决定展示的条目。

不同渠道需要共享一组可识别的语义位置：

- 身份与来源：能追到谁提供、从何处取得，以及可能关联哪个事项；关联尚不清楚时保留未知。
- 内容与证据：保留来源的原始陈述，或可访问的原文引用；摘要不能冒充原文。
- 来源时间：区分观测或收到的时间与事情发生的时间；未知发生时间用未知表达。
- 渠道解读：解释专有术语、状态码、时间含义与范围，并标明哪些来自渠道规则、哪些是适配器的推断。

适配器可以由代码、模型或二者组合完成。同构意味着字段表达一致，不意味着各渠道已经达成语义共识：“邮件标为高优先级”与“监控系统 P1”可以作为来源信息保留，但不默认落在同一条用户重要性尺度上。

## 3. 两条来源如何进入同一轮整理（后续切片）

![两种渠道保留来源并采用同构输入，Agent 结合背景形成结构化输出](assets/illustrations/03-input-output.png)

*统一表达保留来源差别；用户计划打印，并不表示材料已经齐全。图中省略了声明批次、内核校验与保存。*

沿用[用户故事 US-01](user-stories.md)的签证情境。签证代理发来邮件，用户随后留下一句话。`subject_ref` 是候选关联，尚未识别到同一事项时可以为空。

```json
{
  "id": "obs-mail-17",
  "source": {"channel": "email", "author": "签证代理", "ref": "mail:17"},
  "subject_ref": "visa-trip-oct20",
  "observed_at": "2026-10-09T10:01:00+08:00",
  "occurred_at": null,
  "content": "还缺纸质银行流水，请在10月12日18点前送到。",
  "interpretation": {
    "basis": "邮件正文明确说明材料及送达期限",
    "meaning": "10月12日18点是材料送达截止，不是这条消息可撤下的时间。",
    "unknowns": ["用户是否已经准备好流水"]
  }
}
```

```json
{
  "id": "obs-user-18",
  "source": {"channel": "user_message", "author": "小林", "ref": "message:18"},
  "subject_ref": "visa-trip-oct20",
  "observed_at": "2026-10-09T10:03:00+08:00",
  "occurred_at": null,
  "content": "我下午去打印，原定10月20日的出差照常。",
  "interpretation": {
    "basis": "用户陈述；按消息日期解读“下午”",
    "meaning": "用户计划今天下午打印，并确认出差安排仍有效。",
    "unknowns": ["打印是否实际完成", "材料是否已送达"]
  }
}
```

两个 `occurred_at` 都为空，避免声称已经知道缺材料从何时开始，或打印已经发生。在首切片里，这两条内容会作为签证声明的 `sources` 附件出现，而不是独立的 Observation 记录。

## 4. 声明与输出的结构

### 批次与回执

`commit` 只接受 JSON 对象，不接受裸声明数组。调用方在发出请求前生成 `batch_id`，并保留原始请求，直到取得确定结果：

```json
{
  "batch_id": "us01-followup",
  "declarations": [
    {
      "id": "visa-materials",
      "relation": "supersedes:visa-materials",
      "summary": "已约周五 10 点；等你下午打印的银行流水。",
      "weight": "critical",
      "kind": "needs-you",
      "reason": "预约已确认；流水仍未补齐。"
    },
    {
      "id": "visa-appt",
      "relation": "supersedes:visa-appt",
      "summary": "已确认周五 10 点办理。",
      "weight": "high",
      "kind": "done"
    }
  ],
  "acknowledges": ["ann-1"]
}
```

`batch_id` 是本地存储范围内唯一、非空且不超过 128 字符的请求标识。actor 与 now 由命令参数提供，属于请求内容；declarations 和 acknowledges 均可省略，默认空数组。声明数组保留顺序；同一批中不能有两个声明同时改写同一个条目 ID。修改单个子项可直接按其全局 ID 提交，不必复制整棵树。

`annotate` 同样由调用方通过 `--batch-id` 提供请求标识，actor 在首切片固定为 `user`。其批注 ID 由工具产生；重复原请求返回原批注 ID，不新建第二条批注。

| 结果 | 回执与持久化含义 |
| --- | --- |
| 新请求完成保存 | `accepted: true`、`batch_status: committed`，返回 batch_id、event_seq、revision 和实际结果。checked 也是已保存的批次。 |
| 已保存 ID 再次提交相同请求 | 不再执行或追加事件；`batch_status: already_committed`，回传原结果及原 revision，而非当前最新 revision。 |
| 已保存 ID 携带不同请求 | `accepted: false`，错误 `batch_id_conflict`；此前结果仍存在，不得解释为该 ID 从未写入。 |
| 新请求校验不通过 | `accepted: false`，返回约束、目标和实际值；不改变状态/revision，不追加事件、不占用已提交 ID。 |
| 未收到确定回执或写入中断 | 结果未知。以 `fold history --batch <id>` 核对，不从退出或超时推断“没有写入”。 |

相同请求指解析后的命令类型、actor、now 和参数内容相同；commit 比较 JSON 内容而非文件路径，先补齐省略数组的默认值，JSON 对象键顺序不影响比较，数组顺序保留。结果未知时，重试须沿用同一 batch_id 与原请求，包括原 now。已提交后形成的新方案使用新 ID；明确收到校验拒绝后，因该 ID 未被占用，可以沿用它提交修正方案。历史未找到该 ID 后可以重试原请求，工具仍须在同一写入保护范围内再次检查重复，防止尚未结束的原调用随后落地。

### 声明字段

| 字段 | 输入要求 | 取值与效果 |
| --- | --- | --- |
| `id` | 必填，不可 null | `[a-z0-9-]{1,64}`；全存储范围唯一，同一事项生命周期内不变。 |
| `title` | 新建时必填，不可 null | 非空，≤ 12 字；supersede 省略时保留。 |
| `summary` | 最终有子层时必需且不可为空 | ≤ 60 字；父层摘要应自足。无子层时可用 null 清空。 |
| `weight` | relation 不是 withdraw 时必填，不可 null | critical / high / normal / low / trace。 |
| `kind` | relation 不是 withdraw 时必填，不可 null | needs-you / in-progress / done / fyi。 |
| `relation` | 默认 new，不可 null | new / supersedes:<id> / merges:[ids] / detail-of:<id> / withdraw。 |
| `due_at` | 可省略或 null | ISO 时刻，行动截止；null 清空。 |
| `stale_after` | 可省略或 null | ISO 时刻，信息失效；null 清空。 |
| `share` | 可省略或 null | 显式覆盖须为正整数且同时给 reason；null 取消覆盖。 |
| `reason` | 降档、改变或取消份额覆盖、撤下时必填 | 非空的人类可读说明；撤下子层或子项也适用。 |
| `sources` | 可省略、null 或数组 | `[{channel, ref, quote?, observed_at?}]`；null 与空数组都归一为 []。 |
| `children` | 可省略、null 或声明数组 | 同结构递归；省略保留子层，显式列表给出目标子层，null/[] 撤下原子层。 |

withdraw 只需 id、relation 和 reason，不必重新提供 weight、kind 等原内容。批次的 acknowledges 只能引用已保存批注；引用不存在时整批拒绝，不默默忽略错误 ID。

### 补丁、子层与留存

supersede 是补丁语义：除上表明确要求每次提交的字段外，省略字段保留原值。它保留 created_at、批注、来源和未声明的子层，旧版本在历史中可查。显式 null 仅能清空允许为空的字段，最终合成状态仍须满足类型、必填与层级约束；不能清空 id、title、weight 或 kind。

存储以 `share_override` 记录显式覆盖，`share` 始终是可用的数值结果。supersede 省略 share 时继承原覆盖；没有覆盖则根据本次 weight 派生。`share: null` 将 share_override 置 null，并按本次 weight 重算，不能产生空份额。

显式 children 列表描述目标子层：已有子项按其 ID 与 relation 更新，新子项按 new 创建，旧子项若未列入则按撤下处理，必须有相应 reason。只改一个既有子项时，优先单独 supersede 它的 ID，并省略父项 children。children:null 或 [] 意味着撤下原有全部子树，保留其资料和关系；当前父项归一为无子层。

withdraw 使目标及其后代退出当前展示，释放它们在各自当前层中的份额。原 ID、父子关系、内容、来源、批注和撤下原因在历史中保留，可按 ID 查询；后代的未确认批注仍进入待确认反馈视图。不能用清空 children 绕过这条留存规则。

重新纳入使用 supersedes 指向原有 withdrawn ID，恢复该条目为 active，保留 created_at、资料与反馈；状态改变属于业务变化，更新 updated_at。仅恢复本批明确声明的条目，旧后代不自动恢复：省略 children 只保留当前 active 子项，历史 withdrawn 子项保持撤下。恢复子项沿用原父子归属，其最终父项必须 active，可在同一批中先恢复父项；否则返回 inactive_parent 并整批拒绝。恢复后的每层重新检查预算，恢复父子关系也计入相关条目的结构变化。

merges 释放被合并条目的当前占用，新条目继承其批注，历史指向合并后的条目；不得隐式丢弃旧子层或来源。涉及子层重新组织时，声明必须明确给出目标归属，否则拒绝含糊的合并。

父子 kind 没有固定组合约束，父事项仍需用户参与、某个子步骤已经完成是合法状态。但同一事实的摘要应一致：上面的预约提交同时更新父项和预约子项，而不是让“已预约”与“待确认”一起成为成功用例。

### 有效变化、确认与版本

先应用补丁、归一化与派生，再比较每个条目自己的业务字段：title、summary、weight、share_override、kind、期限、sources、直接子项身份/归属和活动状态。系统生成的时间、rank 和单独的 reason 改写不构成业务变化；相同内容的 supersede 不归档新版本、不刷新 updated_at。无业务变化时提交的 reason 只留在批次请求记录中，不改写条目已有 reason。仅子项内容变化不刷新父项，改变父子归属则属于相关条目的结构变化。

| 本批有效结果 | 记录 type | revision | 条目 updated_at |
| --- | --- | --- | --- |
| 有业务变化，可同时确认批注 | commit | 增加一次 | 只更新发生业务变化的条目 |
| 无业务变化，有新增确认 | acknowledge | 增加一次 | 全部保持 |
| 无业务变化，无新增确认 | checked | 保持 | 全部保持 |
| 用户保存批注 | annotation | 保持 | 全部保持 |

批注状态只有 `saved / acknowledged`。saved 表示尚未收到处理确认，不能证明 Agent 没读过；acknowledged 表示已在一次成功整理中确认或回应，不证明建议已采纳或外部行动已完成。首次确认绑定该次 revision；再次引用已确认批注不重复确认、不覆盖首次 revision，也不单独引起版本增长。

同内容 supersede 加新 acknowledges 属于 acknowledge；重复确认且无业务变化属于 checked。checked 仍带 batch_id、actor、now 并写入历史，可据此显示最近一次无变化检查的时间，它不是用户阅读记录。

### 份额与排序

没有显式覆盖时，脚本按 weight 派生 share：critical 3B/8，high 3B/16，normal 3B/32，low 3B/64，trace 1，向下取整、最小 1。B = 64 时为 24 / 12 / 6 / 3 / 1。总和超过预算时整批拒绝。

rank 按 share 降序，同 share 时 needs-you 优先，再按 updated_at 新者优先，最后按 id 字典序。Agent 不提交 rank。checked、仅确认以及相同内容的 supersede 不改变条目时间，因而不会凭空刷新这项排序依据。

### 快照、事件与时间视图

下面展示 US-01 最后一次提交后的简化快照；省略了部分普通字段，但各层 items 列出了该层全部条目：

```json
{
  "revision": "r3",
  "last_event_seq": 4,
  "root": {
    "budget": 64,
    "used": 42,
    "items": [
      {
        "id": "visa-materials",
        "title": "签证材料",
        "summary": "已约周五 10 点；等你下午打印的银行流水。",
        "weight": "critical",
        "share_override": null,
        "share": 24,
        "rank": 1,
        "kind": "needs-you",
        "status": "active",
        "reason": "按用户批注完成预约；流水仍未补齐，事项未完成。",
        "created_at": "2026-10-09T08:30:00+08:00",
        "updated_at": "2026-10-09T14:05:00+08:00",
        "last_seen_at": null,
        "due_at": "2026-10-12T18:00:00+08:00",
        "stale_after": null,
        "annotations": ["ann-1"],
        "sources": [{"channel": "email", "ref": "mail:17", "quote": "还缺纸质银行流水，请在10月12日18点前送到。", "observed_at": "2026-10-09T10:01:00+08:00"}],
        "children": {
          "budget": 64,
          "used": 42,
          "items": [
            {"id": "visa-bank", "summary": "需要近 6 个月纸质流水", "weight": "critical", "share": 24, "rank": 1, "kind": "needs-you", "status": "active"},
            {"id": "visa-appt", "summary": "已确认周五 10 点办理。", "weight": "high", "share": 12, "rank": 2, "kind": "done", "status": "active"},
            {"id": "visa-passport", "summary": "已交", "weight": "normal", "share": 6, "rank": 3, "kind": "done", "status": "active"}
          ]
        }
      },
      {"id": "weekly-report", "title": "周报草稿", "summary": "草稿已完成，收入数字有一处需要核对。", "weight": "high", "share": 12, "rank": 2, "kind": "done", "status": "active"},
      {"id": "pr-batch", "title": "PR 进展", "summary": "2 / 3 已合并，剩余一项等待 CI。", "weight": "normal", "share": 6, "rank": 3, "kind": "in-progress", "status": "active"}
    ]
  },
  "annotation_status": {"ann-1": "acknowledged"},
  "annotation_bound_to": {"ann-1": "r3"}
}
```

每个已接受的写请求只追加一条完整 JSONL 记录，包含 event_seq、batch_id、type、actor、now、revision、用于重复核对的规范请求以及恢复所需的 changes/确认信息。内部 changes 可以包含多个条目操作，重放时作为一个整体应用。checked 和 annotation 也占用 event_seq，因此事件序号不等于 revision。快照的 last_event_seq 说明已经应用到哪条记录。

事件记录是提交与恢复的事实来源，快照是可重建缓存。完整记录落地后，即使快照更新或回执返回中断，仍可按 batch_id 查到本次提交，并在读取状态前补齐快照；不以快照暂时落后推断批次失败。具体本地写入与恢复顺序见[架构](architecture.md)。

交给 Agent 的 state 视图在快照上增加 age、since_update、until_due、until_stale，以显式 now 计算；期限为空时对应投影为 null，到期只改变时长表述，不改变 status。首切片不采集用户查看，last_seen_at 和 since_seen 均为 null，表示未采集，不能写成 never。state 读取和用户批注均不自动产生阅读证据。

消费关注与呈现时，主要信号为：

| 字段 | 回答的问题 | 不能推出什么 |
| --- | --- | --- |
| weight / share | 当前层为它分配多少关注？ | 不是通用紧急性或通知许可。 |
| rank | 先呈现哪项？ | 由确定规则派生，不单独表达判断。 |
| kind | 用户需要做什么？ | needs-you 不等于必须立刻打断。 |
| status | 是否在当前展示树中？ | withdrawn 不等于资料删除。 |

身份、来源、批注和时间字段同样是结构契约的一部分。重要性与紧迫性的依据写在 reason 和 summary 中，供人和模型阅读；首切片不另设精确数值评分。

## 5. 同一输出可以有哪些消费者

- **文字简报（首个消费者）：** 按 rank 排序；critical 和 high 各自成段并加粗标题；normal 单行；low 和 trace 折成一行尾注“另有 n 项次要事项”；有 children 的标“▸ n 项细节”；时间用时长；withdrawn 不显示，尾注给历史入口。预算在这里体现为行数，只做投影，不重算份额。
- **Pinboard 与其他 UI（后续）：** 使用稳定身份、摘要、层级与份额展示当前局面；坐标与布局稳定属于渲染器。
- **推送消费者（后续）：** 依赖 `kind` 与 `weight` 做阈值，不用 `share`；发送、去重与送达由消费者负责。
- **输出日志：** 按序记录每次已接受的变化，附快照 revision，供细查 Agent 当时如何调整状态。它只覆盖实际留下的输出记录，不能还原所有原始输入。

## 6. 三条必须保留的边界

![输入观测记录与已接受状态事件分别保存，校验失败返回修订而不改变已接受状态](assets/illustrations/11-incoming-vs-committed.png)

*两类记录回答不同问题。图中 10:01 与 10:03 是观测时间，不是事情发生时间。*

**声明不等于已接受的批次记录。** 新请求校验不通过时，错误返回 Agent 修订，不进入事件流，也不改变当前状态和 revision。重复 ID 的回执须区分“此前已提交”和“不同内容冲突”，不能一概解释为从未写入。重放按 event_seq 应用完整批次，不重新调用模型解释原始消息。

**说了什么不等于做成什么。** “用户说已付款”“系统确认付款”“Agent 已确认这条批注”是不同事实。批注保存、acknowledges 记录的处理确认、展示调整及外部行动结果分别追踪，不用一个通用 status 表达。

**消费者的投影不等于新的共同状态。** 文字简报的折叠或推送的筛选只影响该消费者的结果；若要改变共享条目及份额，必须提交声明并进入相同的校验与执行流程。
