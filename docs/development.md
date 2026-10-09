# 工作环境与启动交付

状态：本文件描述已存在的仓库工具。产品运行时和技术栈仍待确定，见[决策记录](decisions.md)。

## 本轮环境

使用 Python 标准库完成仓库辅助工作，不安装第三方依赖。Python 3.11+、Git 和 Make 足以运行当前命令；这项选择不决定未来 Fold 内核使用 Python、TypeScript 还是其他语言。

首次初始化时，本机 `python3 --version` 为 `Python 3.14.6`。其他机器使用自己的兼容 Python 即可；没有把本机路径写入项目配置。

在仓库根目录执行：

```sh
make setup
make check
```

![make setup 创建本地虚拟环境，make check 检查启动文件、本地链接和基础格式](assets/illustrations/15-development-workflow.png)

*这些命令准备仓库工具环境并检查材料，不验证尚未实现的产品功能；Python 也不代表产品技术栈已经选定。*

`make setup` 使用 `python3 -m venv .venv` 创建独立环境，Python 自带的 pip 随环境初始化，不联网下载依赖。已有 `.venv` 时再次运行不会清空环境。可以用 `make setup PYTHON=/path/to/python3` 指定解释器。

`make check` 使用 `.venv/bin/python` 运行仓库检查，再执行 `git diff --check`。无需激活虚拟环境。也可以不用 Make，直接运行：

```sh
python3 -m venv .venv
.venv/bin/python -B scripts/check.py
git diff --check
```

上述命令按 macOS / Linux 的目录结构编写。当前没有项目依赖需要锁定或安装；后续选定实现方案时，再添加对应的依赖清单与锁文件。

## 检查的范围

`scripts/check.py` 检查启动交付文件是否齐全，以及维护中的 Markdown 是否使用有效的仓库内文件链接；也检查这些文档是否存在行尾空白或缺少结尾换行。它支持本仓库使用的内联 Markdown 链接，跳过代码围栏，不验证标题锚点、引用式链接和外部网址。

历史草案位于 `docs/reference/`，按原件保留，不参与维护中文档的链接和格式检查。它的片段、接口和交互原型描述不能被这项检查验证。

`git diff --check` 检查 Git 可见的变更格式。当前还没有产品实现与产品测试；启动检查成功只说明这些启动材料和工具可用。

## 文件清单

| 文件 | 用途 |
| --- | --- |
| [README.md](../README.md) | 阅读入口与项目当前状态 |
| [AGENTS.md](../AGENTS.md) | 仓库开发协作约定 |
| [product.md](product.md) | 从原稿和讨论提炼的产品定义 |
| [visual-guide.md](visual-guide.md) | 按文档定位配图与对应章节的索引 |
| [assets/illustrations](assets/illustrations) | 项目内保存的配图与完整生成提示词 |
| [user-stories.md](user-stories.md) | 五个具体使用情境、呈现示例与成功观察 |
| [information-contract.md](information-contract.md) | 泛化输入与结构化输出的概念契约及 JSON 样例 |
| [formal-model.md](formal-model.md) | 输入输出、语义估计、预算与执行的数学探索 |
| [skill-design.md](skill-design.md) | 语义判断指引、配套操作工具、动作契约与验证提案 |
| [architecture.md](architecture.md) | 顶层设计与职责边界 |
| [decisions.md](decisions.md) | 方向、提案、待讨论问题及原稿变化 |
| [development.md](development.md) | 本文：环境与检查说明 |
| [reference/design-v0.3.md](reference/design-v0.3.md) | 用户原始设计草案的原样副本 |
| [Makefile](../Makefile) | 环境初始化与检查入口 |
| [scripts/check.py](../scripts/check.py) | 无第三方依赖的启动检查 |
| [.editorconfig](../.editorconfig) | 编码、换行和缩进约定 |
| [.gitattributes](../.gitattributes) | 文本文件统一使用 LF 换行 |
| [.gitignore](../.gitignore) | 忽略环境、缓存和本地临时文件 |

`.venv/` 是命令生成的本机环境，不提交版本库，也不属于需要通读的项目材料。`.local/` 可用于本机试验数据，已被 Git 忽略；后续产品存储路径尚未确定。

## 读完以后如何继续

先选定一个真实的完整往返场景，再处理[决策记录](decisions.md)中与它直接相关的问题。实现要求、行为示例、产品目录和测试命令随后一起补入，避免在需求仍在讨论时搭建多套空框架。
