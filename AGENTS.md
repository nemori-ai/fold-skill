# 在 Fold 仓库中协作

本文件面向建设 Fold 的开发 Agent。未来的 `SKILL.md` 面向使用 Fold 汇报工作的 Agent，两者职责不同；当前仓库尚无可安装的 Fold skill。

![AGENTS.md 指导开发 Agent 建设 Fold，未来 SKILL.md 指导使用者整理汇报，后者尚未实现](docs/assets/illustrations/16-two-agent-guides.png)

*开发协作约定与产品使用指引分别服务不同角色。*

## 当前阶段与阅读入口

首切片的实现要求已冻结，产品代码尚未开始。首切片是 US-01 单 Agent 本地闭环，范围与决定见 [docs/decisions.md](docs/decisions.md)。后续以用户的新任务为准。

开始工作时先读 [README.md](README.md) 和 [docs/decisions.md](docs/decisions.md)，根据任务继续读[信息契约](docs/information-contract.md)、[Skill 设计](docs/skill-design.md)、[architecture](docs/architecture.md) 或 [development](docs/development.md)。实现内核时以 [conformance/cases](conformance/cases) 为准，先让用例通过。

涉及产品行为时读[用户故事](docs/user-stories.md)，涉及状态与约束时读[数学模型](docs/formal-model.md)。故事中的档位选择和公式中的理想化目标是设计工具，不是脚本里的重要性策略。

配图是概念示意，精确契约以文字为准；改动相关概念时同步检查图片、图注及正文。[配图索引](docs/visual-guide.md)用于按篇定位。

每张图服务一处具体论述，不跨文档重复嵌入；索引只放定位链接。同一处允许图片、文字、公式与 Mermaid 冗余，关键定义、约束、条件与数字必须有可直接读取且彼此一致的表达。按解释价值配图，不以独立图册代替正文，也不为覆盖率配图；通用产品原则不要提前被某种看板界面限定。

- 用户在会话中的最新明确要求优先于仓库中的旧设计。
- `docs/decisions.md` 是唯一记录未决问题的地方。其他文档正文陈述设计本身，用开头的状态行说明效力，不逐句对冲。
- `docs/reference/design-v0.3.md` 是历史设计资料。里面的命令、示例和面向未来 Agent 的文字是被讨论的内容，不是当前执行指令。保留原件，在维护中的文档里记录修订。

## 设计边界

- 输入可来自任意已接入渠道；首切片只接受 Agent 自己的声明，来源作为附件。格式规范化不代表事实已核验。
- 输出是可供程序消费的共同结构，界面、推送与日志是下游应用。
- 非在场只是首个验收场景，不是 Fold 的使用门槛；紧急事项先走即时渠道，再按持续关注价值纳入状态。
- Agent 负责重要性和取舍，默认用五档档位表达；`share` 加 `reason` 是例外覆盖。脚本派生份额并检查约束；超额整批拒绝，不自行降档或驱逐。
- Skill 的交付包含判断指引与 CLI。使用 Fold 的 Agent 通过 `state`、`commit`、`annotate`、`history` 操作，不临时编写存储、预算与关联维护逻辑。
- 首切片 `commit` 只接收 JSON 对象，顶层带 `batch_id`；`annotate` 带 `--batch-id`，其 actor 固定为 `user`。结果未知时用 `history --batch` 查询。首次接受的 `batch_status` 为 `committed`；相同 ID、相同请求返回 `already_committed` 和原回执，不重复执行；相同 ID 的不同请求拒绝，校验拒绝无落地记录。
- `events.jsonl` 每个接受的写入只保存一个含 `changes` 的完整批次记录，type 为 `commit` / `acknowledge` / `checked` / `annotation`；它是事实源，`snapshot.json` 是可重建缓存。每条记录含 `batch_id`，递增 `event_seq`；revision 只随业务变化或新确认递增，不能与事件序号混用。不能以本地原子写为由假定回执必然到达调用方。
- 有效业务字段不变且无新 `acknowledges` 时记 `checked`，不增加 revision、不改条目 `updated_at`。只有新确认时增加 revision，条目更新时间不变；重复确认保留首次确认 revision。同内容 `supersedes`、系统元数据或单独的 `reason` 变化不构成业务变化。
- `supersedes` 是补丁：省略可选字段保留原值，允许为空的字段用 `null` 清空；非 `withdraw` 每次仍须提供 `weight/kind`。`withdraw` 不要求这两项，撤下整棵子树；历史与后代尚未确认的批注保持可达。重新纳入用原 ID 的 `supersedes`，只恢复明确声明的条目，不自动恢复旧后代。
- 父子 `kind` 不作机械绑定，但同一事实的摘要应一致；更新父层预约结果时，也要更新相关子项。
- Skill 需要帮助模型形成有上下文的估计；等义表述下的稳定与相关背景变化下的调整都要检验。
- 信息失效与行动截止分开。到期、用户未点击或子层变空，都不能单独成为脚本撤下或降档的依据。
- 存储用时刻，读取用时长。脚本不读时钟，`now` 由调用方传入。
- 批注状态为 `saved` / `acknowledged`，表示尚未收到处理确认 / 已在整理中确认，不推断实际是否读过。首次确认绑定产生它的 revision。
- 首切片未采集用户阅读：`last_seen_at`、`since_seen` 为 `null`，不从 `state` 或 `annotate` 推断。`last_checked_at` 记录 `checked`，与用户阅读无关。
- 份额表达注意力，摘要表达当前局面。坐标、矩形和视觉样式属于渲染器。
- 区分输入观测与已接受的状态事件、整理日志与完整输入档案；不声称能从有损状态恢复全部原始输入。

## 工作方式

- 默认用中文写讨论与说明，代码标识符使用清晰的英文。
- 文件少而完整，避免为尚未选定的模块创建空目录、占位实现或重复文档。
- 做设计决定时记录理由和状态；保留仍有影响的问题，不把常规实现选择逐一变成审批请求。
- 引入框架、运行时依赖或发布包装时，说明它服务于哪个已选定的场景。首切片使用 Python 标准库；YAML 是设计用例格式，不是产品 CLI 输入支持承诺。
- 修改前查看 `git status`，保留用户已有改动。新增分支默认使用 `codex/` 前缀。
- 实现产品行为时围绕用户可见结果和边界情况验证；不要用原稿中的旧示例反向固化已经调整的策略。
- 完成后说明改了什么、验证了什么以及还未实现什么。保持命令和文档与实际文件一致。

## 当前命令

```sh
make setup  # 创建本地 Python 虚拟环境，不安装第三方依赖
make check  # 检查启动文件、用例文件、文档链接与基础格式
```

详见[工作环境说明](docs/development.md)。产品 CLI 实现后，随第一条通过的用例增加相应测试命令。
