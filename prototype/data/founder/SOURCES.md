# founder 演示数据的来源

状态：2026-11-03，随演示数据维护。这份数据里没有任何第三方内容，公开不需要许可，也没有署名要处理。

`scenario.mjs` 的输入全部来自 [founder 语料](../../../corpus/founder/README.md)：陆晨这个人、他的公司、客户、同事、家人和两周里的 2532 条消息，都是作者照着[大纲](../../../corpus/founder/OUTLINE.md)与[写作指引](../../../corpus/founder/WRITING.md)编写的，不来自真实的人、聊天记录或公开数据。Agent 的判断来自一次真实模型的自由运行，再经人工打磨，见 [POLISH.md](POLISH.md)。

| 项 | 内容 |
| --- | --- |
| 人物与机构 | 全部虚构：陆晨与家人、铃语科技与同事、白鹭口腔、北岸资本、听澜语音、云阶模型、声通云、曲声、禾木宠物医院、开源库 saydone 与它的贡献者、语音AI小聚。名字在合成前查过，不与仓库里另外两份数据重名，见[大纲第 8 节](../../../corpus/founder/OUTLINE.md#8-风险与接缝)。 |
| 真实平台 | 飞书、微信、GitHub、Discord、X、携程、阿里云、招聘平台只作渠道名和例行通知；故障、涨价、报价都只给虚构的供应商。 |
| 链接与账号 | 公司与飞书文档用 `.example` 域名；GitHub 仓库、账号与 issue 编号是编的，`github.com` 上的链接打不开或指向无关的东西。 |
| 引用长度 | 每条输入的正文截到 500 字符（含省略号），原长写在 `text_length`；事项来源里的引文截到 280 字符。自由运行看到的正文截在 1500 字符。 |
| 模型写的文字 | 事项的标签、摘要、理由与逐条处置的理由是模型在自由运行里写的；打磨时改过的地方逐条记在 POLISH.md。 |

演示的正文与 `corpus/founder/messages.json` 一致；`frames.json` 只在本机由 `scripts/founder_corpus.py build` 重建，演示数据由 `scripts/build_demo_data.py founder` 从它与 [edits.json](edits.json) 生成。
