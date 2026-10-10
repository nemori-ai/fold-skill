# 工作环境与启动交付

状态：本文件描述已存在的仓库工具，并说明后续实现的验收要求。首切片核心 CLI 使用 Python 标准库；可选概览模块需要浏览器运行环境，见[决策记录](decisions.md)。

## 本轮环境

仓库基础检查使用 Python 标准库，不安装第三方依赖；Python 3.11+、Git 和 Make 足以运行下述 `make setup`、`make check` 和本地原型命令。文档与原型体验站另有 Node.js 构建入口，见下文。

首次初始化时，本机 `python3 --version` 为 `Python 3.14.6`。其他机器使用自己的兼容 Python 即可；没有把本机路径写入项目配置。

在仓库根目录执行：

```sh
make setup
make check
```

![make setup 创建本地虚拟环境，make check 检查启动文件、本地链接和基础格式](assets/illustrations/15-development-workflow.png)

*这些命令准备仓库工具环境并检查材料；首切片核心使用 Python 标准库，产品功能尚未实现。*

`make setup` 使用 `python3 -m venv .venv` 创建独立环境，不联网下载依赖。已有 `.venv` 时再次运行不会清空环境。可以用 `make setup PYTHON=/path/to/python3` 指定解释器。

可选状态概览的浏览器运行环境另行准备；`make setup` 不安装浏览器。未安装可视模块不影响普通 JSON 查询与核心 CLI。渲染器尚未实现，安装及调用命令随实现补入。

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

## 体验站构建与发布

体验站使用子域名 [fold.vibecoding.icu](https://fold.vibecoding.icu/)，由 `wrangler.jsonc` 的 Custom Domain 配置绑定到同一个 Worker，Cloudflare 管理 DNS 与 HTTPS 证书；根域名不绑定此项目。

体验站是独立的静态文档与交互实验，使用 Node.js 22+。VitePress 提供导航和中文本地搜索；Mermaid 与 MathJax 分别呈现文档已有的流程图和公式。依赖版本由 `package-lock.json` 固定，不改变首切片核心 CLI 使用 Python 标准库的决定。

```sh
npm ci
npm run site:dev
npm run site:build
npm run site:preview
```

本地站点默认在 `http://127.0.0.1:4174`。`scripts/prepare-site.mjs` 从仓库文档和原型源码生成 `site/.generated/`，随后 VitePress 输出 `dist/`。修改原始文档后，重新运行上述开发或构建命令同步内容；不要直接编辑生成目录。`make prototype` 仍可单独在 4173 端口运行原型。

`npm run deploy` 先重新构建，再通过已登录的 Wrangler 发布 `dist/`。`wrangler.jsonc` 只配置静态资源托管，不配置数据库、生产业务 API 或真实账户接入。原型的私人消息与 Agent 判断仍为演示编排。

发布前运行 `make check` 和 `npm run site:build`，并核对文档链接、公式、流程图、搜索及原型交互。站点构建成功不等于产品 CLI 的持久化与完整验收已经完成。

## 实现时使用哪份规范

产品 CLI 的输入、回执与重试规则见[信息契约](information-contract.md)，调用指引见 [Skill 设计](skill-design.md)，文件写入与恢复见[架构](architecture.md)。这些能力尚待实现，不属于上面的仓库检查命令。

产品 CLI 只接收 JSON；YAML 是设计用例的表达格式。测试运行器可以读取或转换用例，不因此给产品 CLI 引入 YAML 支持。

设计中的 `fold state` 可选导出同一快照对应的 JSON 与概览 PNG，也可附加差异数据。浏览器负责真实 HTML/DOM 渲染与截图，不用图像生成模型绘制业务状态；参数、产物和失败行为以[信息契约](information-contract.md)为准，模块边界见[架构](architecture.md)。

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
| [conformance/cases](../conformance/cases) | 六组一致性用例：往返、超额拒绝、批次回执与复核、补丁与子树、操作边界、状态概览 |
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

按 [decisions.md](decisions.md) 的实施顺序推进。六组用例覆盖：

- `01-us01-roundtrip.yaml`：覆盖、合并、父子事实一致与批注往返。
- `02-us03-overflow-reject.yaml`：超额拒绝、Agent 让位与历史查询。
- `03-batch-receipts-and-checks.yaml`：批次重试、结果查询、无变化复核和仅确认提交。
- `04-patch-and-subtree.yaml`：补丁保留与清空、子树撤下及反馈可达、沿原 ID 逐项重新纳入。
- `05-operation-boundaries.yaml`：条目操作的适用范围与拒绝边界。
- `06-state-overview.yaml`：可选概览、范围选择、差异与渲染失败边界。

初期运行器可调用内存核心，配合内存事件、批注与文字简报验证行为。内存用例通过只证明这一层的实现，不代表文件持久化、故障恢复或产品 CLI 已完成；首切片完成需要后续层的对应验收。

故障验证可结合两种方式：用测试钩子稳定触发指定边界，再用少量真实子进程崩溃与 CLI 往返检查实际文件和进程行为。不能只用进程内异常模拟就宣称持久化恢复完成，也不必把每项核心断言都变成子进程测试。

概览验收需要检查实际生成的 PNG 和 DOM：布局是否对应所选层级与份额，字体是否可读，长文本是否溢出，版本、范围和省略提示是否清楚，并与对应 JSON 核对。仅有 JSON 断言通过不足以证明视觉呈现正确；缺少浏览器或渲染失败时也不能把旧图片当成成功产物。

实现要求、产品目录和测试命令随首条行为实现一起补入。当前 `make check` 只检查材料，不执行产品断言；用例运行器、产品 CLI 与概览渲染器都尚未实现。
