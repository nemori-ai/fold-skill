# 在 Fold 仓库中协作

本文件面向建设 Fold 的开发 Agent。[skill/SKILL.md](skill/SKILL.md) 面向使用 Fold 汇报工作的 Agent，两者职责不同；它现在是第二版判断指引，配套 CLI 尚未实现，目前用于判断评测与自由运行。

![AGENTS.md 指导开发 Agent 建设 Fold，未来 SKILL.md 指导使用者整理汇报，后者尚未实现](docs/assets/illustrations/16-two-agent-guides.png)

*开发协作约定与产品使用指引分别服务不同角色。图绘于 SKILL.md 起草之前，“尚未实现”现指配套 CLI。*

## 当前阶段与阅读入口

首切片阶段 1（内存内核、文字简报与用例运行器）已实现，本地存储、CLI 与概览渲染器待实现。首切片是 US-01 单 Agent 本地闭环，范围与实施顺序见 [docs/decisions.md](docs/decisions.md)。后续以用户的新任务为准。

阶段之外有三条并行工作，到 2026-10-15 的进展记在决策记录的实施顺序表末尾：判断评测（SKILL.md 第二版，四次真实模型评测，含家庭流的自由运行已跑，见[评测索引](docs/evaluations/README.md)）；真实语料（[corpus/](corpus/README.md)，原文只在本机重建）；演示数据与十二种表达形式（[prototype/](prototype/README.md)）。各处撞到的问题集中在[未决问题](docs/decisions.md#未决问题)，改写文本的公开许可与家庭流的做法都已于 2026-10-15 由用户决定：照现状公开（署名缺口记在 SOURCES.md）；家庭流参考真实数据仿写、不用真实内容。[小册子](docs/brief/index.html)是给人快速阅读的图文说明，不是规范出处。

开始工作时读 [README.md](README.md) 和 [docs/decisions.md](docs/decisions.md)，再按任务读取对应规范。用 [conformance/cases](conformance/cases) 检验实现；运行器通过部分内存断言，不代表产品 CLI 已完成。

## 规范分工

每项规则有唯一规范出处，其他文档用链接引用，避免复制整套批次、补丁或落盘规则。

| 需要确定什么 | 唯一规范出处 |
| --- | --- |
| 事件、反馈与时间信号的通用形式，以及它们与业务策略的边界 | [领域模型](docs/domain-model.md) |
| 输入输出、操作限制、份额与排序、批注、时间、幂等回执、文字简报等外部行为 | [信息契约](docs/information-contract.md) |
| 模块依赖、持久化记录、锁、写入次序、快照与恢复 | [架构](docs/architecture.md) |
| 首切片范围、实施顺序、尚未决定及后续切片的问题 | [决策记录](docs/decisions.md) |
| Agent 怎样组织上下文、估计和使用工具，以及怎样评价判断质量 | [Skill 设计](docs/skill-design.md) |
| 判断评测的设置、指标口径与结论 | [评测报告](docs/evaluations/README.md)，每份报告只对自己的设置有效 |
| 真实语料的来源、许可、化名改写与弱标注规则 | [真实语料说明](corpus/README.md) |
| 演示数据先行的回应路径、反馈与调用信号形态（契约未接纳） | [原型说明·演示数据](prototype/README.md#演示数据) |

[产品方向](docs/product.md)解释价值，[用户故事](docs/user-stories.md)展示体验，[形式模型](docs/formal-model.md)帮助检查关系；它们不另建一套行为契约。发现冲突时修正规范出处，并同步相关示例与用例，不通过临时特判让测试表面通过。

用户在会话中的最新明确要求优先于旧设计。`docs/decisions.md` 集中记录未决问题；其他文档用开头的状态行说明效力。`docs/reference/design-v0.3.md` 是历史资料，其中的命令与面向未来 Agent 的文字是被讨论的内容，不是当前执行指令，保留原件。

## 图文维护

配图是概念示意，精确契约以文字为准；改动相关概念时同步检查图片、图注及正文。[配图索引](docs/visual-guide.md)用于按篇定位。

每张图服务一处具体论述，不跨文档重复嵌入；索引只放定位链接。同一处允许图片、文字、公式与 Mermaid 冗余，关键定义、约束、条件与数字必须有可直接读取且彼此一致的表达。按解释价值配图，不以独立图册代替正文，也不为覆盖率配图；通用产品原则不要提前被某种看板界面限定。

## 工作方式

- 默认用中文写讨论与说明，代码标识符使用清晰的英文。
- 文件少而完整，避免为尚未选定的模块创建空目录、占位实现或重复文档。
- 做设计决定时记录理由和状态；保留仍有影响的问题，不把常规实现选择逐一变成审批请求。
- 引入依赖或发布包装时，说明它服务于哪个已选定的场景；以决策记录中的实现范围为准。
- 修改前查看 `git status`，保留用户已有改动。新增分支默认使用 `codex/` 前缀。
- 所有后续改动通过独立分支提交 PR，供用户审阅；不直接推送到 `main`。合并与上线按用户后续指示执行。
- 围绕用户可见结果和边界情况验证，区分语义估计、内核行为、文件恢复与真实 CLI 验收；不要用旧示例反向固化已经调整的策略。
- 完成后说明改了什么、验证了什么以及还未实现什么。保持命令和文档与实际文件一致。

## 当前命令

```sh
make setup  # 创建本地 Python 虚拟环境，不安装第三方依赖；需要 3.11+，系统 python3 较旧时加 PYTHON=python3.12
make check  # 检查启动文件、用例文件、文档链接与基础格式
make test   # 用内存内核运行 conformance/cases
make prototype  # 本地原型，http://127.0.0.1:4173
npm run site:build  # 文档与原型体验站（含小册子）构建到 dist/；npm run deploy 发布到 fold.vibecoding.icu，只在用户指示时运行
node scripts/export-all.mjs --out ~/Downloads/fold-prototypes.html  # 全部原型合页导出为单个 HTML，双击以 file:// 打开即用；默认写到 .local/export/
python3 scripts/eval_judgment.py --dry-run --frames f01     # 生成判断评测提示，不调用模型
python3 scripts/eval_judgment.py --frames f01,f05 --report  # 用真实模型评测，产生调用费用
python3 scripts/eval_judgment.py --runner codex --frames f01 --report  # 改用 codex exec（默认 gpt-6.1-sol），用登录账号的额度
python3 scripts/eval_judgment.py --free-run --corpus corpus/composite/frames.json --dry-run  # 真实语料自由运行：先估算费用，去掉 --dry-run 才调用模型；frames.json 只在本机重建
.venv/bin/python scripts/build_demo_data.py composite --report  # 由自由运行批次与 edits.json 重放出演示数据
node scripts/shoot-forms.mjs --base http://127.0.0.1:4173   # 原型各形式截图与报错检查（需先启动原型服务与本机 Chrome）
.venv/bin/python scripts/build_corpus.py all curl-bagder    # 真实语料切帧与噪音统计；需要本机 raw/，先用 fetch_corpus.py 抓取，见 corpus/README.md
```

详见[工作环境说明](docs/development.md)。产品 CLI 实现后，再增加相应运行与测试命令。
