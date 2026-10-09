# 工作环境与启动交付

状态：本文件描述已存在的仓库工具。首切片的实现栈是 Python 标准库，见[决策记录](decisions.md)。

## 本轮环境

使用 Python 标准库完成仓库辅助工作，不安装第三方依赖。Python 3.11+、Git 和 Make 足以运行当前命令。

首次初始化时，本机 `python3 --version` 为 `Python 3.14.6`。其他机器使用自己的兼容 Python 即可；没有把本机路径写入项目配置。

在仓库根目录执行：

```sh
make setup
make check
```

![make setup 创建本地虚拟环境，make check 检查启动文件、本地链接和基础格式](assets/illustrations/15-development-workflow.png)

*这些命令准备仓库工具环境并检查材料；首切片使用 Python 标准库，产品功能尚未实现。*

`make setup` 使用 `python3 -m venv .venv` 创建独立环境，不联网下载依赖。已有 `.venv` 时再次运行不会清空环境。可以用 `make setup PYTHON=/path/to/python3` 指定解释器。

`make check` 使用 `.venv/bin/python` 运行仓库检查，再执行 `git diff --check`。也可以不用 Make，直接运行：

```sh
python3 -m venv .venv
.venv/bin/python -B scripts/check.py
git diff --check
```

## 检查的范围

`scripts/check.py` 检查启动交付文件与用例文件是否齐全，以及维护中的 Markdown 是否使用有效的仓库内文件链接；也检查这些文档是否存在行尾空白或缺少结尾换行。它支持内联 Markdown 链接，跳过代码围栏，不验证标题锚点、引用式链接和外部网址。

历史草案位于 `docs/reference/`，按原件保留，不参与维护中文档的链接和格式检查。

`git diff --check` 检查 Git 可见的变更格式。当前还没有产品实现；用例文件先于代码存在，产品 CLI 实现后再增加运行用例的命令。

## 产品输入、记录与重试

以下是待实现 CLI 的约定，区别于上面已经可运行的仓库命令。`commit` 只读取 JSON 对象，顶层必填 `batch_id`；`declarations` 与 `acknowledges` 均可省略，默认空数组。YAML 只用于表达一致性设计用例，不要求产品依赖 YAML 解析器。

```text
fold commit batch.json --now <ts> --actor <name>
fold annotate <id> "<text>" --now <ts> --batch-id <batch_id>
fold history --batch <batch_id>
```

所有写入都带 `batch_id`，`annotate` 的 actor 固定为 `user`。新接受请求的回执为 `batch_status: committed`；已接受的同 ID、同请求重试返回 `already_committed` 与原回执及原 revision，不重复执行；同 ID 的不同请求拒绝。校验拒绝不落地；遇到超时或回执丢失，先按批次查询，不能把“未收到成功”当成“没有写入”。

`.fold/events.jsonl` 为每个接受的写入保存一个含 `changes` 与回执的完整批次记录，是事实源；`.fold/snapshot.json` 是可由已落地记录重建的缓存。记录 type 为 `commit`、`acknowledge`、`checked` 或 `annotation`，都带批次身份。`event_seq` 逐条递增，revision 只在业务变化或新批注确认时递增，两者不是同一个序号。

无变化复核不增加 revision 或改动条目 `updated_at`；只有新确认时增加 revision，条目更新时间仍保留。不能用批注保存或 Agent 读取推断人的阅读；首切片 `last_seen_at` 与 `since_seen` 为 `null`，表示未采集，`last_checked_at` 只反映 `checked` 记录。

## 文件清单

| 文件 | 用途 |
| --- | --- |
| [README.md](../README.md) | 阅读入口与项目当前状态 |
| [AGENTS.md](../AGENTS.md) | 仓库开发协作约定 |
| [decisions.md](decisions.md) | 已对齐方向、首切片决定、推迟清单 |
| [product.md](product.md) | 从原稿和讨论提炼的产品定义 |
| [user-stories.md](user-stories.md) | 五个具体使用情境、呈现示例与成功观察 |
| [information-contract.md](information-contract.md) | 声明字段、份额与排序规则、快照与事件结构 |
| [skill-design.md](skill-design.md) | 何时调用、上下文视图、判断指引、CLI 动作与验证计划 |
| [formal-model.md](formal-model.md) | 输入输出、语义估计、预算与执行的数学探索 |
| [architecture.md](architecture.md) | 顶层设计与职责边界 |
| [conformance/cases](../conformance/cases) | 四组一致性用例：往返、超额拒绝、批次回执与复核、补丁与子树 |
| [visual-guide.md](visual-guide.md) | 按文档定位配图与对应章节的索引 |
| [assets/illustrations](assets/illustrations) | 项目内保存的配图与生成提示词 |
| [development.md](development.md) | 本文：环境与检查说明 |
| [reference/design-v0.3.md](reference/design-v0.3.md) | 用户原始设计草案的原样副本 |
| [Makefile](../Makefile) | 环境初始化与检查入口 |
| [scripts/check.py](../scripts/check.py) | 无第三方依赖的启动检查 |
| [.editorconfig](../.editorconfig) | 编码、换行和缩进约定 |
| [.gitattributes](../.gitattributes) | 文本文件统一使用 LF 换行 |
| [.gitignore](../.gitignore) | 忽略环境、缓存和本地临时文件 |

`.venv/` 是命令生成的本机环境，不提交版本库。`.local/` 可用于本机试验数据，已被 Git 忽略；产品 CLI 的默认存储目录是工作目录下的 `.fold/`。

## 读完以后如何继续

按 [decisions.md](decisions.md) 实现内核、存储与文字简报中对应的行为，再运行完整用例，包含简报断言；不能在渲染器尚未实现时声称整组验收通过。四组用例依次覆盖：

- `01-us01-roundtrip.yaml`：覆盖、合并、父子事实一致与批注往返。
- `02-us03-overflow-reject.yaml`：超额拒绝、Agent 让位与历史查询。
- `03-batch-receipts-and-checks.yaml`：批次重试、结果查询、无变化复核和仅确认提交。
- `04-patch-and-subtree.yaml`：补丁保留与清空、子树撤下及反馈可达、沿原 ID 逐项重新纳入。

实现要求、产品目录和测试命令随首条行为实现一起补入；当前 `make check` 只检查材料，不执行这些产品断言。
