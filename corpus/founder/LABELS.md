# 作者标注

状态：由 `scripts/founder_corpus.py labels` 从 [beats/](beats/) 与本机的 frames.json 生成，不要手改；数据在 [labels.json](labels.json)。

依据都是 authored：节拍表写定的应忽略、事项、关注档与问题，覆盖全部五条流。他本人的回复也是合成的，所以评测（`scripts/eval_judgment.py --free-run`）用它检验 Agent 与作者写定是否一致，不检验真实。规则见 labels.json 的 `authored.method`。

## 规模

| 流 | 他人发来 | 应忽略 | 占比 | 本人 |
| --- | --- | --- | --- | --- |
| work | 1220 | 632 | 52% | 300 |
| community | 310 | 280 | 90% | 20 |
| life | 184 | 159 | 86% | 4 |
| family | 292 | 171 | 59% | 79 |
| subscription | 123 | 123 | 100% | 0 |
| 合计 | 2129 | 1365 | 64% | 403 |

事项帧 999 个：engaged 252、later 34、noise 630、untouched 83；作者档 high 以上 7 个。问题 27 个：答 17、失效 4、到窗口结束仍开着 6。

## 问题

| 问 | 事项 | 短问法 | 登记 | 去向 |
| --- | --- | --- | --- | --- |
| m1 | `fd:M-home` | 买哪个电饭煲 | f01 | 答，f02 |
| j1 | `fd:J-trip` | 国庆住哪家 | f02 | 答，f14 |
| i1 | `fd:I-dog` | 带狗看耳朵吗 | f03 | 答，f06 |
| g1 | `fd:G-meetup` | 小聚开场你讲吗 | f03 | 答，f04 |
| k1 | `fd:K-school` | 教师节凑钱吗 | f05 | 失效，f06 |
| e1 | `fd:E-company` | 月报数据页 | f05 | 答，f08 |
| a1 | `fd:A-bailu` | 价目表用哪份 | f06 | 答，f07 |
| h1 | `fd:H-invite` | 去深圳演讲吗 | f06 | 失效，f28 |
| m2 | `fd:M-home` | 月饼订哪家 | f10 | 答，f15 |
| f2 | `fd:F-saydone` | 评审流式接口 | f10 | 开着 |
| l2 | `fd:L-english` | 英语课改周日行吗 | f15 | 答，f16 |
| l3 | `fd:L-english` | 英语课续费吗 | f15 | 开着 |
| e2 | `fd:E-company` | 换默认模型吗 | f16 | 答，f24 |
| a2 | `fd:A-bailu` | 滨江店先退出吗 | f17 | 答，f17 |
| j2 | `fd:J-trip` | 航班提前了改不改 | f17 | 失效，f19 |
| g2 | `fd:G-meetup` | 替补讲者找谁 | f18 | 开着 |
| l1 | `fd:L-swim` | 周三八点接豆豆 | f18 | 答，f20 |
| b1 | `fd:B-outage` | 现在切回门店电话吗 | f20 | 答，f20 |
| f1 | `fd:F-saydone` | 0.9 周五发吗 | f21 | 答，f23 |
| c1 | `fd:C-contract` | 答应国庆前加转接吗 | f21 | 答，f23 |
| b2 | `fd:B-outage` | 接备用语音服务吗 | f22 | 开着 |
| g3 | `fd:G-meetup` | 赞助商上台吗 | f22 | 答，f23 |
| k2 | `fd:K-school` | 签秋游回执 | f22 | 答，f23 |
| i2 | `fd:I-dog` | 明早谁带狗打针 | f22 | 答，f23 |
| c2 | `fd:C-contract` | 季度付款行吗 | f24 | 失效，f25 |
| j3 | `fd:J-trip` | 酒店要加床吗 | f26 | 开着 |
| m3 | `fd:M-home` | 中秋几点去爸妈家 | f28 | 开着 |

## 每帧

作者档在 normal 以上的事项，以及当时开着的问题；其余事项只计数。

| 帧 | critical / high | normal | 其余事项 | 开着的问题 | 应忽略 |
| --- | --- | --- | --- | --- | --- |
| f01 | — | A-bailu、C-contract | 36 | m1 | 36 |
| f02 | — | A-bailu、C-contract | 36 | j1 | 46 |
| f03 | — | A-bailu、D-shops | 33 | g1、i1 | 50 |
| f04 | — | A-bailu、D-shops | 34 | j1 | 54 |
| f05 | — | A-bailu、E-company | 40 | e1、i1、k1 | 43 |
| f06 | — | A-bailu | 34 | a1、h1 | 45 |
| f07 | — | A-bailu、E-company | 30 | e1 | 69 |
| f08 | — | A-bailu、E-company | 37 | j1 | 59 |
| f09 | — | A-bailu | 34 | — | 38 |
| f10 | — | A-bailu | 34 | f2、m2 | 48 |
| f11 | — | I-dog | 27 | f2 | 33 |
| f12 | — | — | 22 | f2 | 25 |
| f13 | — | A-bailu | 27 | f2 | 23 |
| f14 | — | A-bailu | 25 | — | 29 |
| f15 | — | A-bailu | 34 | l2、l3 | 40 |
| f16 | A-bailu（high） | — | 41 | e2、f2、l3 | 51 |
| f17 | A-bailu（critical） | — | 42 | j2 | 75 |
| f18 | — | A-bailu、L-swim | 43 | g2、j2、l1 | 63 |
| f19 | — | A-bailu、L-swim | 46 | e2、f2、g2、h1、l1 | 55 |
| f20 | B-outage（high） | A-bailu | 35 | e2、g2 | 127 |
| f21 | B-outage（high）、C-contract（high） | F-saydone | 36 | c1、f1、f2、l3 | 59 |
| f22 | C-contract（high）、I-dog（high） | B-outage、F-saydone、K-school | 45 | b2、c1、f1、f2、g2、g3、i2、k2 | 79 |
| f23 | — | B-outage、C-contract、C-transfer | 40 | b2、f2、g2 | 53 |
| f24 | — | B-outage、C-contract、C-transfer | 36 | b2、c2、f2、g2 | 45 |
| f25 | — | C-contract | 28 | f2、g2、l3 | 35 |
| f26 | — | B-outage | 28 | b2、f2、g2、j3 | 33 |
| f27 | — | — | 24 | f2、l3 | 25 |
| f28 | — | B-outage、C-transfer | 25 | b2、f2、g2、m3 | 27 |
