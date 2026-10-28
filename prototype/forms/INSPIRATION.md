# 表达形式的灵感来源

状态：2026-10-14 为“拓展表达形式”收集的外部参考，只服务原型构思，不是产品规范。概念与取舍见 [CONCEPTS.md](CONCEPTS.md)，原型入口见 [画廊](index.html)。

每条写三件事：来源、它怎样分配或保护注意力、对 Fold 的启发。标“看图”的条目，图片已下载到本地 `.local/inspiration/`（不提交）并逐张看过，另写从画面上读到的视觉手法；标“仅文字”的条目没有找到可用图片，或站点拒绝了无头浏览器。第一轮共 42 条，其中 26 条看过图。第二轮（#43 起）只找结构的画法，30 条全部看过图，图片在 `.local/inspiration-r2/`，每条另写它对应状态里的哪一种关系。第四轮（#75 起）只找前三轮没碰过的方向，30 条全部看过图，图片在 `.local/inspiration-r4/`，末尾的[第四轮候选](#第四轮候选)由它们长出 8 个新 case。

## 平静技术与环境显示

**1. Ambient Orb**（仅文字）
[Wikipedia：Ambient device](https://en.wikipedia.org/wiki/Ambient_device)。2002 年的玻璃球把道琼斯涨跌映射为颜色，跌红涨绿，靠寻呼网络更新；也被电力公司用来提示用电高峰。
注意力：只有一个连续变量、一个颜色维度，平时不需要读；颜色偏离常态时余光自然会注意到。
启发：Fold 的环境信号只该回答一个问题，比如“现在有没有等我回应的事”，并且常态要足够安静。

**2. Nabaztag 兔子**（看图：`nabaztag.jpg`）
[Commons：Nabaztag on desk](https://commons.wikimedia.org/wiki/File:Nabaztag_on_desk.jpg)。
视觉：白色锥形小兔立在显示器旁，肚子上三个柔光点（一绿两粉）加鼻头一点光，耳朵可以转动。整台设备没有字，信息全在几个光点的颜色与位置上，隔着一张桌子就能看清。
启发：几个点位只够编码几个事实；需要“按一下让它说出来”补全语义，否则用户只知道“有事”不知道“什么事”。

**3. Weiser & Brown《Designing Calm Technology》与 Dangling String**（仅文字）
[calmtech.com 全文](https://calmtech.com/papers/designing-calm-technology)。1995 年 PARC 论文：一根挂在天花板电机上的塑料绳随以太网流量转动，忙时呼呼作响，闲时偶尔抽动。
注意力：信息停在“边缘”，需要时才移到“中心”；人能在不打断手头工作的情况下感知变化。
启发：Fold 的状态可以长期待在边缘，只有登记了回应路径的事才主动进入中心。

**4. Amber Case《Calm Technology》八原则**（仅文字）
[O'Reilly 图书页](https://www.oreilly.com/library/view/calm-technology/9781491925874/)。第一条是“技术应只需要最少的注意”，并主张用光、声、触觉等不说话的方式传递状态。
启发：每种外设只承担它最擅长的一点信息，比如光只说“有没有”，声音只说“刚刚变了”。

**5. Information radiator（Alistair Cockburn）**（仅文字）
[Sketchplanations：Information radiator](https://sketchplanations.com/information-radiator)。好的信息辐射器要大、路过一眼能懂、定期变化所以值得看、容易保持最新。
启发：零事件帧不该制造变化；“定期变化才值得路过时看一眼”反过来要求不变时画面也不动。

**6. Panic Status Board**（看图：`panic-sb-2013.jpg`）
[Panic 博客：Status Board 2013](https://panic.com/blog/panic-status-board-2013-edition/)。
视觉：两块竖放的 55 寸深色屏，面板网格，每块面板左上角是大写小标题。全屏最大的字只给少数几个需要隔着房间读到的数：54°、收件箱 241、公交还有 9 分钟；出勤名单旁是绿色 IN / 橙色 OUT 小块；折线颜色对应人。
注意力：做成办公室的聚集点，路过时读数，不需要坐下操作。
启发：大字号是稀缺资源，只给“走过时必须读到的那一个数”；其余可以很小很密。

**7. Nest Learning Thermostat 的 Farsight**（看图：`nest-farsight.png`）
[Google 博客：第三代 Nest](https://blog.google/products-and-platforms/products/nest/meet-3rd-generation-nest-learning-thermostat/)。
视觉：房间照片里，恒温器只是墙上一枚小黑圆，屏幕上只有一个数字“72”，字大到占满圆面；没有单位、图标或菜单。官方说明：人走进房间它才亮起，远处也看得清。
启发：远看时只显示一个数（比如等你回应的件数），走近或拿起时才给细节。

## 一瞥式界面

**8. Apple Watch Smart Stack**（看图：`smartstack.jpg`）
[Apple Newsroom：watchOS 10](https://www.apple.com/newsroom/2023/06/introducing-watchos-10-a-milestone-update-for-apple-watch/)，[用户指南](https://support.apple.com/en-in/guide/watch-ultra/apdecf142fb9/watchos)。
视觉：顶部一条日期与时间；下面是叠起来的卡片，最前一张完整显示，后面的只露出几像素的边，暗示还有几张。最前卡片里红色的时间段字最醒目，标题黑色粗体，地点灰色，左缘一条红色竖线标出所属日历。
注意力：按时间、位置与活动轮换最相关的卡片。
启发：“露边”就能交代还有几件，不必把列表全部摆出来；颜色只用在时间这一项。

**9. Live Activities 与灵动岛**（看图：`dynamic-island.jpg`）
[Apple HIG：Live Activities](https://developer.apple.com/design/human-interface-guidelines/live-activities)，[Commons：iPhone Dynamic Island](https://commons.wikimedia.org/wiki/File:IPhone_Dynamic_Island.jpg)。
视觉：屏幕顶端一颗黑色胶囊，左端是黄色计时圈，右端是黄色“4:45”，两端颜色与所属活动一致，胶囊中间什么也没有。HIG 建议只用于有明确起止、八小时以内的事。
启发：有期限的“等你”事项可以作为一次性活动挂到期限为止；两端各放一个值就够。

**10. Android At a Glance**（仅文字）
[Google 帮助：At a Glance](https://support.google.com/assistant/answer/10070514)。主屏和锁屏最上方的一行，按情境显示下一个日程、天气警报、通勤或航班。
启发：一行字的位置一次只放一件事，按情境换，而不是轮播全部。

**11. Pebble Time 与 Timeline**（看图：`pebble-time.jpg`）
[Wikipedia：Pebble Time](https://en.wikipedia.org/wiki/Pebble_Time)，[AnandTech 介绍](https://anandtech.com/show/9005)，[Commons 照片](https://commons.wikimedia.org/wiki/File:Pebble_Time_front.jpg)。
视觉：一块很小的方形彩色电子纸，粗体窄字，右侧三颗实体键。Timeline 把上键对应过去、下键对应将来，按中键回到此刻。
启发：时间方向本身就是导航；手表上“往前翻是已经发生的结果，往后翻是快到期的事”。

## 高密度专业面板

**12. Bloomberg Terminal**（看图：`bloomberg.jpg`）
[Commons：Bloomberg Terminal](https://commons.wikimedia.org/wiki/File:Bloomberg_Terminal.jpg)。
视觉：黑底；琥珀色是标签与可编辑字段，白与青是数值，绿红只表示涨跌；每个标签页带编号（“1) Overview 2) Comp Sheets”），键盘可直达；表格里嵌小横条与区间点。非常密，但颜色语法稳定。
启发：密度可以很高，前提是每种颜色只做一件事，每个视图有编号可直达。

**13. 空管飞行进程单（flight progress strips）**（看图：`atc-strips-rack.jpg`、`atc-strip.png`）
[Commons：西班牙阿尔梅里亚进程单](https://commons.wikimedia.org/wiki/File:Fichas_progreso_vuelo_almeria.jpg)，[Commons：进程单字段](https://commons.wikimedia.org/wiki/File:Flight_Progress_Strip.png)。
视觉：每张纸条宽度相同、字段格子固定；呼号用全条最大的粗体放在最左；高度格用斜线分成两半供手写；印着向上或向下的箭头表示爬升或下降；最右是时间。管制员手写改动，并把纸条在架子上挪动位置。
启发：统一格式让人扫视时知道每格在哪；位置表示阶段；本轮改动应像手写一样就地可见，旧值划掉而不是消失。

**14. 阿波罗任务控制室**（看图：`mocr.jpg`）
[Commons：Apollo 13 期间的 MOCR](https://commons.wikimedia.org/wiki/File:Mission_Operations_Control_Room_during_Apollo_13.jpg)。
视觉：前墙是所有人共享的：世界地图与轨道线、数字时钟（距某事件与某事件以来的时间）、电视画面；台下一排排控制台，每人负责一个子系统，小显示器加整排灯钮。
启发：公共墙放所有人共享的时间与总态，个人台放各自负责的细节。这需要“归属”信息，现有状态没有。

**15. 安灯看板（Andon）**（看图：`andon.png`）
[Commons：生产车间的 Andon 看板](https://commons.wikimedia.org/wiki/File:Andon-Board_in_einem_Produktionswerk.png)。
视觉：LED 屏，标题两行；每个产品一列；“Soll / Ist”（目标与实际）两行精确数字并排；下面两行只有彩色圆点表示交付与效率状态。
启发：精确值用数字，状态用色点，两者不混用。

**16. 东京消防厅的分诊牌**（看图：`triage-tags.jpg`）
[Commons：Triage tags (Tokyo Fire Department)](https://commons.wikimedia.org/wiki/File:Triage_tags_%28Tokyo_Fire_Department%29.jpg)。
视觉：上半是填写栏；下缘叠着黑、红、黄、绿四条可撕色带，标 0、Ⅰ、Ⅱ、Ⅲ。撕掉下面几条，剩下最底的颜色就是分类；远看是色，近看是表。
启发：分类显示在边缘，远处可辨；细节留在牌面上，需要时才读。

**17. 后厨显示系统的订单老化色**（仅文字）
[Loyverse KDS 说明](https://help.loyverse.com/help/kitchen-display-system)，[JWU 酒店管理评述](https://inquire.jwu.edu/news/2022/02/kitchen-display-system-review.html)。订单头随等待时长从绿变黄再变红，阈值可按工位设定。
启发：可以用颜色投影“距上次更新多久”；但这只是展示，不能因此改动份额或档位。

**18. 病房患者白板**（仅文字）
[F1000Research 研究](https://f1000research.com/articles/11-150)，[The Hospitalist 评论](https://www.mdedge.com/content/patient-whiteboards-hospital-setting)。“今日目标”和预计出院日最受重视；批评者指出白板常常过期，过期的白板比没有更糟。
启发：共享面板必须写出最后更新时间，过期内容要显式标出。

**19. GitHub Status 状态页**（看图：`githubstatus.png`）
[githubstatus.com](https://www.githubstatus.com/)。
视觉：顶部一整条绿色横幅写一句“All Systems Operational”；每个组件一格，90 根细竖条代表 90 天，绿色为主，偶有琥珀与红；下方“90 days ago — Today”与可用率。颜色只表示严重程度。
启发：一句话总状态在最上；每项一条同尺度的历史条，异常自己跳出来。

## 编辑式与纸面

**20. 报纸头版**（看图：`newspaper.jpg`）
[Commons：Kingsport Times-News 1960 年 4 月 10 日](https://commons.wikimedia.org/wiki/File:Kingsport_Times_News_1960_04_10_1.jpg)。
视觉：一条横跨全版的粗体窄字通栏标题；次级标题用斜体衬线或窄体，分两三档字号，跨几栏就有多宽；七栏网格，栏间细线；左上角“Weather”报耳；照片作视觉锚点；正文字号统一。重要性完全由标题字号乘以跨栏宽度表达。
启发：份额可以变成栏宽与标题字号；报耳适合放“等你几件”这样的固定信息。

**21. The Economist Espresso**（仅文字）
[Campaign：Economist goes daily with Espresso](https://campaignlive.com/article/economist-goes-daily-espresso-app/1321069)，[Adweek 报道](https://www.adweek.com/performance-marketing/the-economist-espresso-offers-bite-sized-dose-of-daily-global-news/)。每天早上一期，开头是当天要知道的五件事，读完就结束。
启发：有终点的简报让人知道“读完了”，不是无限流。

**22. Morning Brew**（看图：`morningbrew-archive.png`，经 Wayback）
[Wayback 存档的一期](https://web.archive.org/web/2022/https://www.morningbrew.com/daily/issues/latest)。
视觉：居中单栏约 600 像素；开头粗体“Good morning.”接口语化导语；行情小表；每个栏目上方一行蓝色大写栏目名（TRIVIA），下接粗体标题与编号列表。
启发：口语化引子加固定栏目，读者每天都知道某类信息在哪一段。

**23. Tufte 的 sparklines 与 Sterne 的叙事曲线**（看图：`shandy.png`）
[Tufte：Sparkline theory and practice](https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/)，[Wikipedia：Sparkline](https://en.wikipedia.org/wiki/Sparkline)，[Commons：《项狄传》叙事线](https://commons.wikimedia.org/wiki/File:Sparkline_of_the_narrative_structure_of_the_first_three_volumes_of_Tritram_Shandy,_accouring_to_the_author.png)。
视觉：Tufte 引用的前身是《项狄传》里作者画的四条叙事线：一条基线上长出圈、尖角和波浪，每个圈是一次离题。Sparkline 是“字大小、高密度、设计简单”的图，嵌在句子里。
启发：文字简报的每一行旁可以带一条份额小线，读字时顺便看到这件事的来路。

**24. Muybridge《The Horse in Motion》**（看图：`horse-small-multiples.jpg`）
[Commons：The Horse in Motion](https://commons.wikimedia.org/wiki/File:The_Horse_in_Motion.jpg)。
视觉：12 格 4×3 排列，每格同框、同尺度、同一套背景刻度线，并编号；只有马在动，所以步态一目了然。这是 Tufte 所说 small multiples 的经典例子。
启发：37 帧同尺度并排，背景完全不变，只让事项变，人就能看出注意力怎样移动。

**25. BERG Little Printer**（看图：`little-printer.jpg`，只看到设备，未看到小票版面）
[designboom 报道](https://www.designboom.com/technology/little-printer-by-berg/)，[Dezeen 报道](https://www.dezeen.com/2012/08/15/bergs-little-printer-now-available-for-pre-order/)。
视觉：书架上一只白色小方盒，正面是一张笑脸，橙色小脚；设备本身安静友好。它把订阅内容打印成两英寸宽的热敏纸“迷你报纸”。
启发：纸的长度天然就是占用；一张就是一期，可以撕下带走、手写回应。

**26. TRMNL 电子墨水屏**（看图：`trmnl-hero.jpg`）
[trmnl.com](https://trmnl.com/)。
视觉：一位黑白电子纸；某个模块里的巨大数字（79°）压倒一切，模块之间用细线分隔，标签是小号字；周历只用几种灰；底部一条写插件名与地点。官方称一次充电约三个月。
启发：没有颜色时，层级只靠字号与粗细；低刷新率设备要写出“更新于几点”。

## 语音与线性媒介

**27. Alexa Flash Briefing**（仅文字）
[Amazon 开发文档](https://developer.amazon.com/en-US/docs/alexa/flashbriefing/flash-briefing-skill-api-feed-reference.html)。每个来源最多五条，超出部分不播；超过七天的条目会被跳过。
启发：线性媒介必须限制条数与时效；听的人无法回头扫视。

**28. 屏幕阅读器的标题导航**（仅文字）
[WebAIM 屏幕阅读器用户调查](https://webaim.org/projects/screenreadersurvey/)。历次调查中“按标题跳转”都是最常用的找信息方式，第 10 次调查为 71.6%。
启发：语音简报要有“标题层”，可以跳到下一件，而不是只能从头听完。

**29. 驾驶场景：NHTSA 与 Android for Cars**（看图：`car-readable.png`、`car-focus.png`）
[Android for Cars 设计原则](https://developer.android.com/design/ui/cars/guides/foundations/design-principles)，[NHTSA 2012 讲话稿](https://www.nhtsa.gov/sites/nhtsa.gov/files/strickland-distraction_guidelines_03122012.pdf)。
视觉：深色界面，对话框只有一个问题，最多两行，下面两颗等宽的大胶囊按钮（Start / No thanks）；浏览过久时盖上一条“Safety pause. Back soon.”进度条。NHTSA 建议单次视线离开道路不超过 2 秒、一个任务累计不超过 12 秒。
启发：开车时最多问一个二选一，其余排队到停车再说；推送时机属于下游应用。

## 时间与变化

**30. Linear Inbox**（看图：`linear-inbox.png`）
[Linear 文档：Inbox](https://linear.app/docs/inbox)。
视觉：深色；顶部“Priority 4 / Other 12”两个带数字的分页；每行两层，上面是事项标题，下面是“为什么在你面前”（某人把它指派给你、在评论里提到你），右侧是 1h、4h、13h 这样的时长；越往下越暗。稍后提醒到点后重新出现，提醒不会隐藏原事项。
启发：每一条都写清它为什么出现在你面前；“稍后提醒”和“已阅”是两件事。

**31. Slack Catch up**（仅文字）
[Slack 帮助：查看全部未读](https://slack.com/help/articles/226410907-View-all-your-unread-messages)。一次只显示一条未读，右滑标为已读，左滑跳过，可撤销。
启发：一次一件的仪式适合清理，但 Fold 的“已阅”必须是明确动作，翻过不等于已阅。

**32. GitHub 贡献日历**（看图：`github-contrib.png`）
[GitHub 用户主页示例](https://github.com/torvalds)。
视觉：53×7 的小方格，绿色深浅表示数量；格子上方一句总数（“3,750 contributions in the last year”）；右下角“Less ▢▢▢ More”图例。
启发：一句总数加一张密度格，就能看出节奏；格子同尺寸、只变深浅。

**33. git blame**（看图：`git-blame.png`）
[GitHub blame 示例](https://github.com/python/cpython/blame/main/README.rst)。
视觉：左侧每一块代码都有一栏：多久之前、作者头像、提交说明；最左边一条细色带按新旧着色，顶部图例“Older ■■■ Newer”，越新越亮的橙色；右侧代码本身不改动。
启发：状态文字旁可以写出“这句来自哪一轮、哪条输入、多久前”，核对时不必离开正文。

**34. Things 3 的 Today 与 This Evening**（看图：`things-collage.png`）
[culturedcode.com/things](https://culturedcode.com/things/)。
视觉：“Today”标题带黄色星；当天日程压缩成顶部一块浅灰小框；每条待办下面一行灰色小字写所属项目；“This Evening”用月亮图标另起一节；手表上全部完成时是一个圆环与“All Done”。
启发：同一天可以按此刻与今晚切开；完成也要有一个看得见的终点。

**35. Sunsama 的每日规划与收工仪式**（仅文字）
[Sunsama：daily planning and shutdown](https://www.sunsama.com/features/daily-planning-and-shutdown)，[帮助文档：Daily shutdown](https://help.sunsama.com/docs/daily-shutdown)。收工时先回顾当天完成了什么，再写一句反思，然后结束工作日。
启发：睡前视图可以只回答“今天了结了什么、什么留到明天、今晚有没有必须处理的”。

**36. 电影《记忆碎片》的外部记忆**（仅文字）
[Wikipedia：Memento](https://en.wikipedia.org/wiki/Memento_%28film%29)。失去短期记忆的主角靠拍立得照片、纸条与纹身记事，难点在于他无法判断每条笔记是谁、在什么情况下写的。
启发：被打断后回来的人最需要知道每条信息来自谁、何时，否则整理越多越不可信。

## 空间与隐喻

**37. Kinopio**（看图：`kinopio-research.png`）
[kinopio.club](https://kinopio.club/)。
视觉：深色无限画布，彩色方框把卡片圈成区域，彩色曲线连接相关卡片，卡片文字很小、密度极高；位置与分组本身携带含义，配小地图导航。
启发：空间分组只有在数据里真有分组与连线时才可靠；Fold 没有事项间的区域与关联，不应凭空画线。

**38. 地面天气图**（看图：`weather-map.png`）
[Commons：NOAA 2018-04-30 地面天气图](https://commons.wikimedia.org/wiki/File:2018-04-30_Surface_Weather_Map_NOAA.png)。
视觉：深红等压线连成闭合曲线；冷锋是蓝色三角、暖锋是红色半圆；巨大的 H、L 标出高低压中心；绿色块是降水；测站符号密布。
启发：天气图表达的是“系统”和“边界”之间的力学关系。Fold 没有这种关系，强行借用会暗示因果，所以放弃。

**39. Solari 翻牌时刻表**（看图：`solari.jpg`）
[Commons：Secaucus 站 Solari 时刻表](https://commons.wikimedia.org/wiki/File:NJT_Main_Line_Solari_board_at_Secaucus_Junction_detail_June_2026.jpg)。
视觉：明黄底板，黑色窄体字印在一片片翻页上；“DEPARTS”列每个数字各占一片，“TO”列一片写完整站名；一行一班，按出发时间从上到下；翻页时整个大厅都能听见。
启发：可以按“何时到期”而不是按份额排序；翻牌声是天然的变化提示，变了才响。

**40. 伦敦地铁图**（仅文字）
[Wikipedia：Tube map](https://en.wikipedia.org/wiki/Tube_map)。Harry Beck 用拓扑代替地理，站距相等、线路只走水平、竖直与 45° 角。
启发：某件事经过的几次改写可以抽象成等距的“站”；本轮未做，B 已覆盖时间演变。

## 身体与外设

**41. Apple Watch 的触觉提示**（仅文字）
[Apple Watch 用户指南：声音与触感](https://support.apple.com/guide/watch/apd58cffe6a4/watchos)，[HIG：Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics)。每种提示音配有同步的触感节奏，用户可以在设置里试听试感。
启发：触觉只能区分很少几类，适合“新增了等你回应的事”这一种信号。

**42. Finviz 市场热力图**（仅文字，无头浏览器被拦截）
[finviz.com 地图](https://finviz.com/map.ashx)。面积是市值，颜色是涨跌，两个变量同时呈现。
启发：原版 Pinboard 已经是这种树图；本轮不再重复面积编码。

## 第二轮：为结构找画法

2026-10-15 补充。第一轮多在找“载体”，第二轮只找“结构的画法”：图形时刻表、传记图、时序图、地层柱、统计图表与手绘数据日记。图片在本地 `.local/inspiration-r2/`（不提交），以下 30 条全部逐张看过。每条写来源、从画面上读到的视觉手法，以及它对应这份状态里的哪一种关系、落在哪张草图（编号见 [第二轮概念卡](CONCEPTS.md#第二轮概念卡)）。

### 时间与身份

**43. Ibry / Marey 巴黎—里昂列车运行图**（看图：`ibry-marey.png`）
[Commons：Ibry's Visual Train Schedule](https://commons.wikimedia.org/wiki/File:Ibry%27s_Visual_Train_Schedule.png)。
视觉：横轴是一天 24 小时，纵轴是车站，站距按真实里程；每列车是一条斜线，坡度就是速度，停站是一小段水平线，几十条线交织成一张网。
关系：时间作为一根贯穿全图的轴，每个对象是一条线，线的形状本身就是它的历史。草图 01 把它竖过来：纵轴是 37 次整理，每件事一条线。

**44. Gotthardbahn 1899 图形时刻表**（看图：`fahrplan-1899.jpg`）
[Commons：Grafischer Fahrplan 1899](https://commons.wikimedia.org/wiki/File:Grafischer_Fahrplan_1899.jpg)。
视觉：车站按线路分成几块，块间留白；最左侧画出线路纵断面，读者先看左栏的地形，再看右边的车次。
关系：轴本身也携带信息。草图 01、04、05 的左栏都写大字日期、星期与整理时刻，定时整理与“检查后未改”在左栏另作标记。

**45. Riesbahn 2005 列车运行图**（看图：`train-graph-riesbahn.png`）
[Commons：Train graph Riesbahn 2005](https://commons.wikimedia.org/wiki/File:Train_graph_Riesbahn_2005.svg)。
视觉：几乎全是同一种蓝色细线，站名竖排在顶上；整张图只靠线的位置与坡度说话，没有第二种颜色。
关系：颜色可以只承担一种含义。第二轮每张草图只让颜色表示一件事：身份，或“来自你”。

**46. Priestley《A Chart of Biography》**（看图：`priestley.png`）
[Commons：PriestleyChart](https://commons.wikimedia.org/wiki/File:PriestleyChart.gif)。
视觉：每个人一条横线，名字直接写在线上，横轴是年代刻度；按“学者”“政治家”分区；生卒不确定的一端改成虚点。
关系：同一身份在一段时间里的存续，以及不确定的那一段。草图 01 的核心：一条线一件事，改名时把新标题写在线旁，撤下期间用虚线保留身份。

**47. Minard 拿破仑东征图**（看图：`minard.png`）
[Commons：Minard](https://commons.wikimedia.org/wiki/File:Minard.png)。
视觉：带宽等于兵力，进军浅色、退军黑色；下方的温度曲线与地图共用横向位置，两张图上下对齐读。
关系：线宽可以是数量，另一条信息可以在同一时间轴上对齐。草图 01 的线宽是份额；草图 02 顶部的整理批次脉冲与下方各路径共用时间轴。

**48. Harry Beck 1933 伦敦地铁图**（看图：`beck.jpg`）
[Commons：Beckmap1](https://commons.wikimedia.org/wiki/File:Beckmap1.jpg)。
视觉：站距相等，线只走水平、竖直和 45°；换乘站是空心菱形；地理被舍弃，只剩拓扑。
关系：按“发生了第几次”而不是按真实时间排距离。草图 01 的纵轴是整理次数，两周的疏密改由左栏时刻说明；两条支流并入费用时走斜线。

**49. Darwin 1837 “I think” 草图**（看图：`darwin.png`）
[Commons：Darwin Tree 1837](https://commons.wikimedia.org/wiki/File:Darwin_Tree_1837.png)。
视觉：一根主干不断分叉，有的枝末端加一道短横杠表示到此为止，有的继续延伸；字母标出分支。
关系：终止与延续的区别。草图 01 用横杠标“撤下”，若之后恢复，虚线接回同一条线并标“↺”。

**50. 叠置不整合示意**（看图：`unconformity.png`）
[Commons：Stacked unconformities](https://commons.wikimedia.org/wiki/File:Stacked_unconformities.png)。
视觉：沉积、抬升、侵蚀、再沉积，前一轮地层被削平，新地层压在断面上，断面用粗线标出。
关系：一段历史中断之后再续上，中间缺失的部分要被看见。对应撤下后恢复（苏禾、取消链路各 9 轮后恢复）；草图 01 把这段缺口画成虚线并写出轮数。

### 开闭与时序

**51. SPI 总线时序图**（看图：`timing-spi.png`）
[Commons：SPI timing diagram2](https://commons.wikimedia.org/wiki/File:SPI_timing_diagram2.svg)。
视觉：每根信号一条水平泳道；数据总线的值写在拉长的六边形格里，相邻两格以 X 形交叉表示换值；高阻态是一条居中的细线；红、蓝竖线把各泳道对齐到时钟边沿。
关系：一条路径何时打开、何时换成新问题、何时回到“无回应路径”，以及这些变化与批次时钟的对齐。草图 02 几乎逐项借用：六边形 = 登记中的问题，交叉 = 改写时换了问题，中线 = 没有回应路径，朱红竖线 = 你的回应。

**52. “永”字笔顺图**（看图：`kanji-ei.png`）
[Commons：永-bw](https://commons.wikimedia.org/wiki/File:%E6%B0%B8-bw.png)。
视觉：当前一笔深黑，已写的笔画中灰，未写的浅灰；红点标起笔，小箭头标方向。三档灰度就把“已发生 / 正在发生 / 尚未发生”分开。
关系：此刻前后的区别。草图 02 在此刻之后铺浅底，只画已知期限；草图 04 用描框标出选定的那一轮。

**53. Lupi《Dear Data》第 22 周**（看图：`dd-giorgia_deardata_22_front.jpg`）
[Dear Data 全部明信片](http://www.dear-data.com/all)。
视觉：小记号沿螺旋排开，少数红色弧形箭头从一个记号指向另一个，表示前后相关的两次事件。
关系：两次事件之间的因果跨度。草图 02 的“稍后提醒”画成从回应点到提醒点的弧线。

### 守恒与让位

**54. Playfair 丹麦—挪威进出口图**（看图：`playfair.png`）
[Commons：Playfair TimeSeries](https://commons.wikimedia.org/wiki/File:Playfair_TimeSeries.png)。
视觉：进口、出口两条曲线，中间的面积按差额方向着色，并直接写上“Balance against”“Balance in favour of England”。
关系：要看的是两个量的差，而不是两个量本身。草图 04 只画每一轮的增减，不画份额本身。

**55. Sankey 蒸汽机热效率图**（看图：`sankey.png`）
[Commons：JIE Sankey V5 Fig1](https://commons.wikimedia.org/wiki/File:JIE_Sankey_V5_Fig1.png)。
视觉：带宽按热量守恒，每处损失从主流分出一支箭头，宽度可以加总回去。
关系：总量守恒下的流向。根层永远是 64 份，草图 04 的左翼（让出与动用的留白）和右翼（拿到与退回的留白）因此每行等长。

**56. du Bois：黑人教师人数逐年横条**（看图：`dubois-2.jpg`）
[Commons：LCCN2013650374](https://commons.wikimedia.org/wiki/File:A_series_of_statistical_charts_illustrating_the_condition_of_the_descendants_of_former_African_slaves_now_in_residence_in_the_United_States_of_America_LCCN2013650374.tif)。
视觉：一年一行的粗横条，数字写在条旁，纸色底上只用一两种浓色；行距一致，条长直接比较。
关系：逐轮比较。草图 04 一轮一行，段内写简称与份数，零变化的行留空并写“检查后不变”。

**57. du Bois：宗教人口的蛇形长条**（看图：`dubois-1.jpg`）
[Commons：LCCN2014645378](https://commons.wikimedia.org/wiki/File:A_series_of_statistical_charts_illustrating_the_condition_of_the_descendants_of_former_African_slaves_now_in_residence_in_the_United_States_of_America_LCCN2014645378.tif)。
视觉：最大的一项太长放不下，就在页内折返成蛇形，长度仍可比较。
关系：极端值不该压扁其他行。草图 04 里最长的是开局“留白 31”，尚能放下；完整版若出现更大的一次重排，可以让翼折返而不缩小单位。

**58. du Bois：职业分布的大括号合计**（看图：`dubois-4.jpg`）
[Commons：LCCN2013650373](https://commons.wikimedia.org/wiki/File:A_series_of_statistical_charts_illustrating_the_condition_of_the_descendants_of_former_African_slaves_now_in_residence_in_the_United_States_of_America_LCCN2013650373.jpg)。
视觉：几个小类用大括号收拢，接到一根合计条上；小项与合计同时可读。
关系：合并。两张提醒（账单、查重）在 10/13 并为费用；草图 01 画成两条细支流汇入费用线，草图 05 把子项的改动记号缩小后归在根事项名下。

**59. du Bois：三州财产的三角拼方**（看图：`dubois-3.jpg`）
[Commons：LCCN2014645361](https://commons.wikimedia.org/wiki/File:A_series_of_statistical_charts_illustrating_the_condition_of_the_descendants_of_former_African_slaves_now_in_residence_in_the_United_States_of_America_LCCN2014645361.tif)。
视觉：四个三角拼成一个正方形，每块是一个组成部分，总数写在下方。
关系：部分拼成固定整体。对应每层都是 64 份；本轮没有画子层，见概念卡末尾“未覆盖的关系”。

**60. Brinton《Graphic Methods for Presenting Facts》1914**（看图：`brinton.jpg`）
[Commons：Graphic methods for presenting facts, p. 6-7](https://commons.wikimedia.org/wiki/File:Graphic_methods_for_presenting_facts,_p._6-7.jpg)。
视觉：竖向百分比条把一个整体分成几段，左右各有一套刻度，读者可以数格。
关系：可以数的单位。草图 04 的顶部是份数刻度，每段内每一份有一道短刻线。

**61. Feltron 2008 年报：嵌套三角**（看图：`feltron08-02.jpg`）
[Feltron 2008 Annual Report](http://feltron.com/FAR08.html)。
视觉：一个大三角递归切成小三角，层级越深越小，少数格子用黄绿强调。
关系：层级份额。与上一条一起，作为子层 64 份的候选画法记下，本轮未做。

### 来源与组成

**62. Lupi《Dear Data》第 1 周：一周看钟**（看图：`dd-giorgia_deardata_01_front.jpg`）
[Dear Data 全部明信片](http://www.dear-data.com/all)。
视觉：一天一列，每次看钟是一个小记号；记号的形状说明为什么看（点、圈、叉、三角），按发生顺序串成一行；少数特例用红点。整张卡读起来像乐谱。
关系：一轮整理由哪些输入组成，各被怎样判。草图 05 的输入记号串直接来自这里：实心采用、空心重复、虚线圈暂缓、× 噪音，朱红只给来自你本人的输入与批注。草图 03 每格里的记号也用同一套形状。

**63. Lupi 长新冠日记**（看图：`lupi-longcovid.jpg`）
[Giorgia Lupi 作品集](https://giorgialupi.com/)。
视觉：一个月一行，每天一小簇彩色笔触；跨越多天的事件用虚线连起来，日子之间的疏密一眼可见。
关系：在很小的格子里保留时间。草图 03 每格是一条两周的小时间线，同一天的多条输入向上下错开堆叠。

**64. Lupi 展墙时间线草图**（看图：`lupi-items.jpg`）
[Giorgia Lupi 作品集](https://giorgialupi.com/)。
视觉：手绘时间线上，事件之间的连接线分成几种画法，旁边有一小段图例说明每种线的意思。
关系：线型本身是一种编码，并且需要图例。草图 01 的实线、虚线、横杠，草图 02 的六边形与中线，都在页脚图例里逐项说明。

**65. Feltron 2013 年报：点刻阶梯面积与侧栏统计**（看图：`feltron13-04.jpg`）
[Feltron 2013 Annual Report](http://feltron.com/FAR13.html)。
视觉：主图是点刻填充的阶梯面积，右侧另起一列小字统计，主图本身不再标数。
关系：每个来源的总量。草图 03 右栏给每个来源一行计数方块，一格一条输入，按采用、重复、暂缓、噪音分段。

**66. Feltron 2008 年报：大数字排版**（看图：`feltron08-03.jpg`）
[Feltron 2008 Annual Report](http://feltron.com/FAR08.html)。
视觉：一个大号数字配一行小字说明，数字本身是版面的主体。
关系：每件事的“版本数”与“名字数”。草图 01 的列头写“17 版 · 13 个名字”，一眼看出哪件事被改写得最多。

**67. 1786 年 Medea 号航海日志**（看图：`logbook-medea.jpg`）
[Commons：Page from the logbook of the Dutch warship Medea in 1786](https://commons.wikimedia.org/wiki/File:Page_from_the_logbook_of_the_Dutch_warship_Medea_in_1786.jpg)。
视觉：左侧大字写星期，一天一段；无事的几天合并成一行“周二到周六无事”；页边速写海岸轮廓。
关系：记录里“什么都没发生”也是一条记录。草图 05 保留“定时整理，无输入”与“检查后未改”的行，左栏大字日期也来自这里。

**68. Bach 手稿**（看图：`bach.png`）
[Commons：Bach1sa2](https://commons.wikimedia.org/wiki/File:Bach1sa2.PNG)。
视觉：五线谱上的小节线把连续的音符切成等价的段，读者按小节而不是按音符计数。
关系：一天作为一个小节。草图 05 用日分隔线切开 37 轮，读者先看一天有几轮，再看每轮的组成。

### 看过但没有采用

**69. Nightingale 玫瑰图**（看图：`nightingale.jpg`）
[Commons：Diagram of the Causes of Mortality in the Army in the East](https://commons.wikimedia.org/wiki/File:Diagram_of_the_Causes_of_Mortality_in_the_Army_in_the_East._%28IA_dr_diagram-of-the-causes-of-mortality-in-the-army-in-the-east-10563002%29.jpg)。
视觉：一个月一个楔形，面积表示人数，三类死因叠在同一楔形里；两年各一朵，用虚线连接。
未采用：可以画“等你 / 进行中 / 已完成 / 知会”的构成随时间变化，但楔形面积难以比较，且与小倍数的信息重叠。

**70. Emma Willard《Temple of Time》1846**（看图：`willard.jpg`）
[Commons：Temple of Time (1846) Emma Willard](https://commons.wikimedia.org/wiki/File:Temple_of_Time_%281846%29_Emma_Willard.jpg)。
视觉：透视的神殿，柱子是世纪，地面是年代表。
未采用：拟物的透视让远处的数据变小，正是第一轮“环境球”的问题；作为反例记下。

**71. Stefanie Posavec《Dear Data》第 1、13 周**（看图：`dd-stefanie_deardata_01-front.jpg`、`dd-stefanie_deardata_13-front.jpg`）
[Dear Data 全部明信片](http://www.dear-data.com/all)。
视觉：从一个中心向外放射的羽状细线，线色区分类别，末端加小圈表示特例。
未采用：放射构图适合“一个中心、很多次”，但 Fold 的输入关联多件事、需要时间顺序，放射会丢掉两者。

**72. 地层柱（Penny Magazine 1833 与 Williston 盆地）**（看图：`strata-penny.jpg`、`strata-williston.jpg`）
[Commons：Penny Magazine 1833 Stratigraphic Column](https://commons.wikimedia.org/wiki/File:Penny_Magazine_1833_021_Stratigraphic_Column.jpg)，[Commons：Williston Basin stratigraphic column](https://commons.wikimedia.org/wiki/File:Williston_Basin_stratigraphic_column.jpg)。
视觉：一根竖柱分层，层厚是时间或沉积量；左右两栏写层名与产地，大括号把几层归为一组；彩色版用颜色表示岩性。
未采用为独立草图：单件事的“地层柱传记”与草图 01 的一条线重叠。它的右栏写法被草图 01 吸收：站名只在标题改写时出现。

## 第三轮：概念动画

两段在 X 上看到的竖幅动画，只看它们怎样传达信息，不评判其中内容是否属实。

**73. 视频 A：搜索树与心跳**（X 用户 @Bober_smart 发布）
[X：@Bober_smart](https://x.com/Bober_smart)。
视觉：纯灰阶、近黑底，一棵从底部根出发的细线搜索树占满画面；一道锯齿弧从根向外扫，云状星点约 2.9 秒闪一次，底部四格流水线约 0.67 秒跳一格，三层时钟互不对齐；全片只有一道闪电路径最亮，24 秒里只改道两次。逐帧拆解见 [motion/pulse/spec.md](motion/pulse/spec.md)。
关系：一个中心、一个节拍、一个焦点。整理脉冲取它的心跳、错拍时钟与“周围越忙、焦点越稳”，把闪电换成朱红线，只给新登记的问题；弧的方向反过来，从外向根收拢，表示整理是在变少。

**74. 视频 B：纸底的“工作室仪表”**（看片：X 用户 @francescoinweb3 发布的 24 秒竖幅视频，1080×1350、60fps；本机下载逐帧拆过，视频与抽帧不入库）
[X：@francescoinweb3](https://x.com/francescoinweb3)。
怎样传递信息：纸白底、墨黑与灰阶，一圈转盘、几条车道、一束细线和八块小仪表占满画面，大约八成是一直在动的质感；承载信息的只有左上的标题卡、一个实心黑游标、它那条车道上的几个黑标签和一个注释框。整段是 6 步 × 4.00 秒，切点只有一帧：标题、游标、注释、仪表同一帧换，转盘与细线不切；每步先留 0.4 秒没有焦点，游标才落下，+0.67 秒注释浮现，+3.73 秒退。秒数的拆解见 [motion/dial/spec.md](motion/dial/spec.md)。
对 Fold 的启发：质感层可以很密而不抢信息，条件是它只用灰、不进信息块、在信息动的那一刻让位；“一帧硬切 + 0.4 秒空白”的节拍让一轮整理成为可数的一拍，正好对应 Fold 的一轮批次。份额拨盘取了节拍、硬切、单个黑游标与灰色质感层；没有取像素小虫（吉祥物式拟物）和静止的装饰计数，红色也不给“量”，只给等你回的问题。
整理脉冲取了三点：步骤名硬切、不缓动；底部流水线框住当前一格，与主图的节拍同一帧变；一条亮线穿过密集的群体，标出“这一刻被运走的是哪几个”，对应采用的事件落到根上、再化成光顺着枝流上去。

## 第四轮：没碰过的方向

2026-10-28。用户说项目有一阵没更新，让我们去互联网上找灵感、再加一些 case。前三轮已经找过平静技术、状态板、消费设备、历史数据图和两段概念动画；这一轮只找没碰过的四个方向：a 近两年的产品动效与空间界面，b 真实的“注意力预算下做决定”的操作界面，c 计算与生成的结构，d 非西方或手工的记法。图片在本地 `.local/inspiration-r4/`（不提交），以下 30 条全部逐张看过；视频与 GIF 先抽帧拼成接触表再看。每条写来源、从画面上读到的视觉手法，以及它对应状态里的哪一种关系、现有 14 个形式（原版树图、A/B/C/D、腕上一瞥、两周小倍数、身份线、回应时序、来源矩阵、让位图、批次记谱，以及整理脉冲、份额拨盘两个动画）有没有画过它。看过但没有收入的 13 条列在本节末尾，由此长出的 8 个候选见下一节[第四轮候选](#第四轮候选)。

### a. 近两年的产品动效与空间界面

**75. Apple Liquid Glass 的两段演示：收起的标签栏，让位的时间**（看图：`a-liquidglass-tabbar-frames.png`、`a-liquidglass-fluidtime-frames.png`）
[Apple Newsroom：WWDC25 新设计语言](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)。
视觉：音乐 App 片段里，静止时是两层（“正在播放”胶囊在上，四个标签加一颗搜索圆钮在下），一向下滚，约 0.4 秒内并成一行：标签只剩当前那一个，胶囊降进同一行。锁屏片段里通知一条、两条叠上来，“9:41”的字高从约四成屏高压到约两成，字宽几乎不变，新来的越多数字越矮。玻璃的折射与高光是拟物渲染，不取，只取形状让位的运动。
关系：英雄数字给新来的条目让面积，屏幕总高固定，数字的形体就是剩下的空间。现有形式里的大数字（份额拨盘环心的 64、B 的“还有几小时”）都是定尺寸，没有一个让数字本身随新增事项变矮；可以用来演“留白被新事项吃掉”。

**76. visionOS 26 的空间小组件：钉在墙上，远了就变简**（看图：`a-visionos26-hero-frames.png`、`a-visionos26-calendar-frames.png`）
[Apple Newsroom：visionOS 26](https://www.apple.com/newsroom/2025/06/visionos-26-introduces-powerful-new-spatial-experiences-for-apple-vision-pro/)，[开发文档：LevelOfDetail.simplified](https://developer.apple.com/documentation/widgetkit/levelofdetail/simplified)。
视觉：客厅里，信息、相册、比分板、日历小卡贴在墙面和桌面的固定位置，镜头转动时它们像物件一样留在原处；月历贴在两扇窗之间，设置只有嵌入开关、框宽滑杆和颜色圆点。文档写明用户走远时小组件换成“更少、更大的元素”。相框的凹凸是拟物，不取。
关系：事项与地点绑定、按距离分级的细节。“远看一个数、近看细节”与第一轮 #7 Nest 重叠；新的只有“按地点常驻，房间本身就是索引”，例如厨房那面墙只钉家事，但这需要“受众与可见范围”，状态里没有。

**77. Flighty 的 “Where's My Plane?”：延误从上游传下来**（看图：`a-flighty-wheres-my-plane.png`、`a-flighty-delay-predicted.png`、`a-flighty-forecast.png`）
[flighty.com](https://flighty.com/)，[9to5Mac：Flighty 的实时活动](https://9to5mac.com/2022/10/24/flighty-dynamic-island-iphone-live-activities/)。
视觉：深灰卡片顶部是红色胶囊“RUNNING LATE”，下一行大字写原因“35m delay predicted due to late arriving aircraft”。下面一根竖线倒序读：最上是“My Flight · 35m Delay Predicted”，往下是空心圈 SFO、正停在“纽约到旧金山，52m Late”这一段上的飞机图标、实心灰点 JFK、更早一段“10m Late”。飞完的段是实心点，未到的是空心圈，每段的迟到数一律红色右对齐。实时卡片里新时刻用绿色大字，原定时刻划线后小字跟在旁边。
关系：上游依赖链，我的事卡在哪一环、前面每一环各晚了多少。现有 14 个形式都没有“谁在等谁”：回应时序只画问题的开与闭，来源矩阵只画谁喂了哪件事。状态里没有事项之间的依赖，但来源里有现成的人与时刻（水管工等你周一前开口，Ulrika 等你回搬迁进展）。

**78. Family 钱包的托盘：每一步高度不同**（看图：`a-family-trays-frames.png`）
[Benji Taylor：Family Values](https://benji.org/family-values)。
视觉：12 秒的加油流程，底下的列表压暗不动，白色圆角托盘浮在上面，四周离屏幕边一指宽。每一步托盘的顶边上下移动：选链四行勾选，中等高；选金额六个块，矮一点；自定金额带数字键盘，最高；确认页列三条 $12 与合计 $36。作者写明托盘“故意各不相同的高度，让进展一目了然”；按钮文字从 Continue 形变到 Confirm，共有的 “Con” 不动。
关系：回应的分量，答这一问要你付出多少（点一下、选一个、挑日子、写一句）。回应组件有六类，D 与腕上一瞥把它们排成同样的卡片，没有一个形式把“要多少力气”画出来。

**79. Linear Pulse 的进度图：预测锥与期限斜纹**（看图：`a-linear-pulse-projection.png`、`a-linear-pulse-stream.png`、`a-linear-pulse-feed.png`）
[Linear 更新日志：Pulse（2025-04-16）](https://linear.app/changelog/2025-04-16-pulse)，[Pulse on mobile（2025-11-13）](https://linear.app/changelog/2025-11-13-pulse-on-mobile)。
视觉：近黑底，灰线是范围（671，11/12 后拉平），黄线是已开始，蓝色面积是已完成，底部每周一根蓝色细柱。从“此刻”的圆点向右分出两条蓝色虚线，夹出一道浅蓝的锥：快的一条在红色竖线 12/31（目标日）碰到范围线，慢的一条拖到 3/2，红线以后整片红色斜纹。另一张是十几条灰色细线描出的堆叠流，只把一层填成砖红。
关系：回应期限与“照现在的节奏会在哪天了结”的对照。B 与回应时序只画期限在此刻之后的哪里，没有一个形式画“会不会晚”；状态里没有预测，要画就得从最近几轮的作答节奏外推并标明。灰底只给一层上色，与第二轮“颜色只给一件事”一致。

**80. Chrome View Transitions：从哪里来，回哪里去**（看图：`a-viewtransition-cards-frames.png`、`a-viewtransition-thumb-frames.png`）
[Chrome 开发文档：Same-document view transitions](https://developer.chrome.com/docs/web-platform/view-transitions/same-document)。
视觉：卡片演示里删掉一张，它略向上退、变浅，同时右边的卡已经滑进它的位置，两件事重叠进行；新卡从“+”按钮的位置落到行尾。缩略图演示里点中的那张自己放大成主播放器，其余缩略图缩成右侧一列窄栏，返回时缩回原格、网格复原。
关系：层级份额的钻取。点开一件事，它自己长成子层 64 份的画框，兄弟事项缩成侧栏，读者知道“我现在在谁的里面”。原版树图、A、C 的换轮已经做了身份连续，但进入子层时父块变画框、兄弟退成侧栏，现有形式都没有做。

**81. iPhone Duo 的半折**（看图：`a-iphone-duo-mlb.png`）
[TechRadar 的配图](https://www.techradar.com/ai-platforms-assistants/chatgpt/chatgpts-new-pulse-feature-will-help-you-manage-your-day-with-handy-visual-updates)。
视觉：半折，上半屏是比赛直播，下半屏是逐局比分和打者表，折痕把“正在发生的”与“记了账的”上下分开。
关系：折叠屏另有代理在做，这里只记一条：折痕本身可以是“此刻”与“账”的分界。

### b. 注意力预算下做决定的操作界面

**82. AMAN 到达管理的时间梯**（看图：`b-aman-d2.png`、`b-aman-d1.png`）
[VATSIM Scandinavia：AMAN MAESTRO](https://wiki.vatsim-scandinavia.org/books/general/page/aman-maestro)，[ICAO APAC：Integrated Arrival and Departure Manager](https://www.icao.int/sites/default/files/APAC/Meetings/2021/2021%20ATMAS%20TF%202/4-Information%20Papers/IP03_SGP-AI.4.4-Benefits-of-an-Integrated-Arrival-and-Departure-Manager.pdf)。图来自模拟飞行社区的 MAESTRO 插件文档，没有找到真实系统的公开截图。
视觉：灰底窄长窗口，中间一根竖向时间尺，每分钟一刻，每五分钟标时刻，此刻在最下端，刻度随时间往下走。每架进场飞机写在尺左侧它被排到的落地时刻上：左边一列是还要吸收的延误分钟数，10、9、7 是红色，2、1、0 是白色；被选中的一架加黑框。示意图把估计时刻与排定时刻画成上下两行竖线，中间的红色横杠就是当前延误。
关系：排队次序与容量。一条跑道、落地率固定，每件事被分到一个槽位，左边的数是“比它自己想到的时刻晚多少”。Fold 里人就是那条跑道，B、回应时序画了期限与开了多久，D 只取最急的 3 张，都没有把问题排进容量受限的次序。

**83. 急诊实时看板：停留时长、分段周转与区域**（看图：`b-ed-los.png`、`b-ed-turnaround.png`、`b-ed-pending.png`）
[Health PEI：ED Real Time Dashboard Training Manual](https://src.healthpei.ca/sites/src.healthpei.ca/files/CIS/ED_Real_Time_Dashboard_Training_Manual.pdf)，[Relias Media：Here's what ED staff can see at a glance](https://reliasmedia.com/articles/116974-here-8217-s-what-ed-staff-can-see-at-a-glance)。
视觉：顶部一排卡片，全科室一张，大字“03:52”中位停留（橙色），右边红、蓝、黄、紫、橙五个区各一个中位数，空区写“--:--”；每张卡下三枚小色块计数（达标、超时、严重超时）。列表按停留时长倒序，4 小时以上整格红底白字，3:01–3:59 只把字变橙，达标的不着色；页脚一行图例写死规则“Target 03:00 · Overdue 03:01–03:59 · Critically Overdue 04:00+”。周转页把流程拆成五段，每段一个中位数。
关系：回应期限与停留时长。CONCEPTS 记过“问题没有自己的截止时间”，急诊的办法是不给每个病人设期限，而给一类等待设统一目标与两档升级；区域卡对应“事项归属”。“已经多久没动”这一列，现有形式只有第一轮撤下的后厨老化色（#17，仅文字）想过。

**84. F1 计时塔：缠斗展开与淘汰线**（看图：`b-f1-race-tv.png`、`b-f1-qualy-tv.png`、`b-f1-2026-tower.jpg`、`b-f1-positions.png`）
[RaceFans：2022 年 F1 电视图形](https://www.racefans.net/?p=478947)，[GPFans：2026 年计时塔](https://www.gpfans.com/en/f1-news/1078428/f1-2026-tv-broadcast-new-timing-tower-graphic/)。
视觉：左侧一根深色竖塔 20 行，每行只有名次、车队标、三字母缩写、与前车的间隔和轮胎字母，字很小。正赛里第 1、2 名之间被撑开成一块，红字小标题“BATTLE FOR 1st”，两行改成白底大名牌，中间是全屏最大的数“+0.038”，其余 18 行不动。排位赛在第 15 名的位置插一条红字“DRIVER AT RISK”。
关系：排名里的边界。份额是排序，真正要看的是两处缝：相邻两件差距最小处（f26 根层有四件并列 6 份），以及折叠线（D 只放 3 张大卡）。没有形式在此刻的名次里只撑开一个缝、给出那个差值。

**85. 主飞行显示 PFD 的速度带与高度带**（看图：`b-pfd-737.png`、`b-pfd-svg.png`）
[Commons：Primary Flight Display of a Boeing 737-800](https://commons.wikimedia.org/wiki/File:Primary_Flight_Display_of_a_Boeing_737-800.png)，[Commons：Primary Flight Display.svg](https://commons.wikimedia.org/wiki/File:Primary_Flight_Display.svg)。
视觉：黑底，左右两根灰色竖带，当前值永远在中间的黑框里，鼓轮数字上下滚、刻度在框后滑动。洋红只给飞行员选定的目标（带顶的“250”“38000”与带边的洋红游标），白色只给实际值，绿色只给模式；速度带上端是红黑相间的“理发店柱”，标出不能超过的速度。
关系：目标与实际、趋势与界限。颜色语法与 Fold 一致：洋红只给人选定的，对应朱红只给来自你本人的。状态里有 `share_override` 与逐轮份额，可以画“你要的份额”与“Agent 给的份额”；份额拨盘画了环上占比，没有目标游标与趋势箭头。

**86. DAW 电平表的峰值保持**（看图：`b-ardour-recorder.png`、`b-ardour-meters.png`、`b-ardour-67.png`）
[Commons：Ardour 6.7 Recorder Editor Mixer](https://commons.wikimedia.org/wiki/File:Ardour_6.7_Recorder_Editor_Mixer.png)。
视觉：每轨一根横向电平表，亮绿条是此刻，条后停着一道黄色短竖线是近期最高；混音台的竖表上方一道细线停在峰值处，表头黑框里写峰值的数（-4,5、-16,3、-inf）。录音窗右上角单独一个大按钮“Reset Peak Hold”：峰值一直停着，直到操作者按下才清。
关系：上次接触锚点之后的起落。现有形式只画此刻，小倍数要逐格翻才看得出起落；峰值线停在你离开期间的最高处，直到你“已阅”才清，正是“翻过不等于已阅”的可见形态。

**87. 围棋的分段谱**（看图：`b-kifu-pair.png`、`b-kifu-89-105.jpg`、`b-kifu-alphago.png`）
[Commons：关山—桥本 1943 年第 89–105 手](https://commons.wikimedia.org/wiki/File:Sekiyama-hashimotou-19430506-89-105.jpg)，[Commons：Lee Sedol vs AlphaGo 第 1 局](https://commons.wikimedia.org/wiki/File:Lee_Sedol_%28B%29_vs_AlphaGo_%28W%29_-_Game_1.svg)。
视觉：分段谱只画这一段的 17 手：此前已在盘上的子是无字的实心黑与空心白，这一段的新子才写手数，从 1 重新编到 17。一眼看出右下 1–10 连成一串，5、11、13、15、17 跳到别处。全谱把 186 手都写在子上，连续的数挤成一列，角与角之间的跳跃要找数字才看得出。
关系：一段时间里注意力落在哪里、按什么次序，并且编号从“上次看的那张图”之后重新开始。批次记谱一轮一行，小倍数一帧一格，都没有把次序写回同一张版面；分段而不是全谱，是这种画法能读的前提。

**88. 纽约时报 2016 年选举指针**（看图：`b-needle-2016.jpg`）
[Reuters Institute：Moving the needle](https://reutersinstitute.politics.ox.ac.uk/news/moving-needle-how-new-york-times-aims-guide-readers-through-americas-most-uncertain-election)，[Quartz：指针的抖动大多是随机的](https://qz.com/831944/the-new-york-times-election-result-projections-are-mostly-random-jitters)。
视觉：白底三个半圆表，各配一句大字结论（“>95% Trump”“Clinton +1.2”“306 Trump”），颜色只表示两党；指针后面一片同色浅楔形是模拟区间。刻度上另有两道虚线写“OBAMA '08”“OBAMA '12”，把历史值钉在同一刻度上。抖动是有意加的不确定性，读者却当成新数据进来，因此被批评制造焦虑。
关系：历史锚点，虚线刻度就是“你上次看时在这里”。另是一条反例：动起来的东西会被读成“有新事实”，与第三轮“概念层不暗示信息层没有的事实”是同一条规则。

**89. 棋局复盘的评估条与评估曲线**（看图：`b-chesscom-blunder.png`、`b-chesscom-review-panel.png`、`b-lichess-analysis.png`）
[Chess.com：Game Review 设计更新](https://www.chess.com/news/view/game-review-design-update)，[Chess.com 帮助：Game Review](https://support.chess.com/en/articles/10328363-how-do-i-use-game-review-on-the-app)，[Commons：Lichess analysis board](https://commons.wikimedia.org/wiki/File:Lichess_analysis_board.png)。
视觉：棋盘左侧一根黑白竖条，白色占的长度就是白方的优势，顶上标“3.1”。复盘面板顶上一句教练式的总结，下面是一条评估曲线：曲线以下是白面、以上是深色，中线是均势，每步一个点按好坏着色（绿最佳、橙失误），红色竖线是当前这一步；再往下是双方各类着法的计数。lichess 在着法表里插灰底说明“Inaccuracy. Nxe2+ was best.”，坏棋在棋盘那一格挂一枚“?!”。
关系：两股力量此消彼长。把“家里”和“工作”当成双方，份额在 64 份里拔河：哪个生活领域在吃掉预算，什么时候翻过中线。小倍数按身份着色，看不出领域之间的拉锯；CONCEPTS 的[真实数据下的问题清单](CONCEPTS.md#真实数据下的问题清单)给小倍数提过“改按流着色，看工作与生活此消彼长”，至今没有一个形式画它。“最佳着法”式的打分不取，状态里没有“最好的一轮”作参照。

### c. 计算与生成的结构

**90. Vera Molnár《(Des)Ordres》1974**（看图：`c-molnar-desordres.jpg`、`c-molnar-desordres-toledo.jpg`）
[DAM：(Des)Ordres, 1974](https://dam.org/museum/artists_ui/artists/molnar-vera/des-ordres/)，[Toledo Museum：Infinite Images](https://infiniteimages.toledomuseum.org/?p=839)。
视觉：17×17 的方格阵，格子位置完全规整，每格里套着数目不同的同心方框；线多的格近乎全黑，少的只剩外框和中心一点，整张图的灰度全靠“每格画了几圈”。彩色版是蓝绿细笔，个别格子里只有一圈红，有的方框略微歪斜，有的格子整个空缺，但网格本身从不散掉。
关系：份额的驻留时长。64 份一格一份，同心圈数等于这一份连续几轮没换主人。现有形式都把份额画成“此刻属于谁”；小倍数能逐帧看归属，却看不出某一份已经连续十轮没动。

**91. Vera Molnár《Interruptions à recouvrements》1969**（看图：`c-molnar-interruptions.jpg`）
[Commons：Interruptions à recouvrements](https://commons.wikimedia.org/wiki/File:Vera_Molnar._Interruptions_%C3%A0_recouvrements_from_1969.jpg)。
视觉：连续折页的绘图仪纸，上下缘是走纸孔和打印头标 “benson france”。满幅是随机朝向的短线，像一地松针；两块矩形区域叠了第二层短线，明显更黑，矩形没有轮廓线，边界只靠密度的突变显出来；左页右下还有一块整片留白。
关系：上次接触锚点，用叠印表达“自你上次看后”：两层都在的地方加深，是没变的；只剩一层的变浅，是新来的或已走的。差异只靠密度，不画框、不贴“新”标签。首切片 `last_seen_at` 恒为 null，现有形式都拿上一帧代替，也没有一种用叠印。

**92. Tyler Hobbs：曲线之间的最小间距**（看图：`c-hobbs-mirror-removal.jpg`、`c-hobbs-ribbons.jpg`、`c-hobbs-circlepack-starts.jpg`）
[Tyler Hobbs：Flow Fields](https://www.tylerxhobbs.com/words/flow-fields)，[Fidenza](https://www.tylerxhobbs.com/fidenza)。
视觉：《Mirror Removal #5》里几百条顺着同一个流场弯曲的黑线保持等距、彼此不碰；流场收拢、挤不下的地方，线被截成一串短划，越挤划越短。文章原话是“check if any other existing curves are too close, and if so, stop”。《Festival Notes》把同一规则用在宽条带上，条带被切成一节节，下半幅挤满，上半幅只剩散落的短片。
关系：排序与份额的耦合，长尾怎样得到位置。按 `rank` 依次在 64 份的场里生长，先长的线最长，后来的只能在缝里长成短划，碰撞就是让位；原版树图和 C 都把长尾折叠或缩成小珠，没有一种画出“先到先得、挤不下就变短”。

**93. Jared Tarbell《Substrate》2003**（看图：`c-tarbell-substrate.jpg`、`c-tarbell-substrate-2.jpg`）
[complexification.net：Substrate](http://www.complexification.net/gallery/machines/substrate/)。
视觉：细黑裂纹从已有裂纹上垂直长出，每条线都止于另一条线，满屏是 T 形交点，把平面切成越来越小的长方形，像城市街区；裂纹一侧带一抹沙色渐变，没长到的边缘还是大片空白。
关系：份额空间被切分的先后。T 形交点本身记录了时间，停下的那条比它撞上的那条年轻，一张静图里就能读出谁最早划出地盘、谁是后来从别人的地盘里切出来的。“谁从谁那里切出来”需要让位配对，回执里没有，只能按同轮一涨一缩近似。

**94. Casey Reas《Process Compendium 2004–2010》**（看图：`c-reas-process-compendium.jpg`）
[CreativeApplications：Process Compendium](https://www.creativeapplications.net/project/process-compendium-processing/)，[reas.com：Process](https://reas.com/process)。
视觉：黑底等宽字，先是几十个带箭头的“元素”在走，接着一张纯文字卡写规则（F1 圆、F2 线；B1 直线运动……E1 = F1 + B1 + B2 + B3 + B4）。随后元素本身不再画，只画两两接触时连在两个中心之间的灰线，接触越久叠得越亮；底部一条时间刻度，左右两个计数。
关系：事项之间因共同来源而产生的关联，只在两件事被同一个人推动时留一道痕。Kinopio（#37）因为状态里没有事项间连线而放弃，这里的痕来自真实的共同来源；但同一条输入关联两件以上的只有 31 条，太稀，按发件人共现才够密。

**95. 池田亮司 data.tron（Transmediale 2010）**（看图：`c-ikeda-datatron-1.jpg`、`c-ikeda-datatron-2.jpg`）
[Commons：Data-Tron-1](https://commons.wikimedia.org/wiki/File:Transmediale-2010-Ryoji_Ikeda-Data-Tron-1.jpg)，[Commons：Data-Tron-2](https://commons.wikimedia.org/wiki/File:Transmediale-2010-Ryoji_Ikeda-Data-Tron-2.jpg)。
视觉：近看是满屏极小的像素数字，一格一个，小到远看只剩一片中灰纹理；某些值的格子被反白成黑块，于是灰里浮出成簇的暗斑。远景是一整面墙，按列排着小面板，每块左上一行标签。
关系：全部输入与被采用的少数，远看是密度、近看是精确值。批次记谱与整理脉冲已经画了“一条输入一个记号”，这里新的只有“远近两读”和“一个不漏地印”，适合海报，不单独成候选。

**96. Karim Douïeb “Land doesn't vote, people do”（2019）与瑞士版**（看图：`c-landvote-steps.png`）
[GitHub：votemapswitzerland](https://github.com/zumbov2/votemapswitzerland)，[FlowingData：transition to a cartogram](https://flowingdata.com/2019/10/08/fixing-the-impeach-this-map-with-a-transition-to-a-cartogram/)（FlowingData 对抓取返回 403，原作 Observable 页面无头浏览器没有渲染，看的是瑞士改编版）。
视觉：左右两图共用同一条红蓝图例。左边是面积分区图，乡村大块的红色压住全国；右边每个市镇缩成一个圆，圆面积等于选民数，圆留在原地附近、靠碰撞互相推开，大城市的深蓝大圆一下子翻转了整体印象。原作把两图做成一段连续变形，论点就在这段变形里。
关系：输入的量与份额是两种量。同一批事项留在原位，从“收到多少条输入”变形成“占多少份”：master CI 两周 149 条只占 6 份，车道铜管 29 条却占 24 份，Agent 的判断就是这段变形本身。来源矩阵数来源，整理脉冲把输入汇到根上，没有一种让同一件事的两种量在原地互相变换。

**97. d3 圆填充**（看图：`c-d3-pack.png`）
[Observable：@d3/pack](https://observablehq.com/@d3/pack)。
视觉：浅灰实心圆是叶子，写名字和数值；父节点只画一圈细灰轮廓，一层套一层。圆与圆之间留下大量空白，原文说这些“浪费”的空间更能显出层级；很小的叶子只剩无字的灰点。
关系：层级份额，层级靠包含、不靠颜色。子圆面积按父层的 64 份算，跨层比较要换算成有效份额（父 24 份 × 子 6/64 = 2.25 份），否则会误读；composite 两周没有子层，只能用手写情境。

### d. 非西方或手工的记法

**98. 结绳记事 khipu：主绳、垂绳、副绳与合计绳**（看图：`d-khipu-locke-xxi.jpg`、`d-khipu-locke-fig45.jpg`、`d-khipu-larco.jpg`）
[Commons：The Ancient Quipu Plate XXI](https://commons.wikimedia.org/wiki/File:The_Ancient_Quipu_Plate_XXI.jpg)，[Commons：The Ancient Quipu Figure 45](https://commons.wikimedia.org/wiki/File:The_Ancient_Quipu_Figure_45.jpg)，[Commons：Inca Quipu（Larco 博物馆）](https://commons.wikimedia.org/wiki/File:Inca_Quipu.jpg)。
视觉：Locke 1923 年的图版是黑底白绳，顶上一根横向主绳，下面挂一排垂绳，结打在不同高度，字母 a–n 逐个标注；其中一根垂绳中段又分出一根副绳；右栏是 1 到 9 圈的长结，圈数就是数字。Figure 45 是一根合计绳，横着绑在四根垂绳上方，记的是它们的和。Larco 的实物摊成半圆扇形，几百根绳并排，远看结聚成几道同心带：同一数位的结落在离主绳同样远的地方。
关系：层级份额与分组合计。主绳是根层，垂绳是事项，副绳是子层，合计绳是一组事项的和；离主绳的距离是数位，所以同一属性在所有事项上横向对齐。现有形式都只画根层。只借结构，不借绳的质感。

**99. 意匠图与提花纹板**（看图：`d-pointpaper-morris.jpg`、`d-draftbook-1805-9.jpg`、`d-sari-cards.jpg`）
[Commons：Morris & Co. Dove and Rose point paper](https://commons.wikimedia.org/wiki/File:Morris_and_Co_Dove_and_Rose_point_paper.jpg)，[Commons：Weaver's Draft Book (Germany), 1805](https://commons.wikimedia.org/wiki/File:Weaver%27s_Draft_Book_(Germany),_1805_(CH_18394477-9).jpg)，[Commons：Kanchipuram 纱丽的纹板](https://commons.wikimedia.org/wiki/File:India_-_Sights_%26_Culture_-_Hand-loom_pattern_cards_for_silk_sari_weaving_(2507306023).jpg)。
视觉：Morris 的意匠图是细灰方格纸，每 8 格一道深红线，切成 8×8 的块，每格只涂一种颜色；远看格子消失，只剩鸟和花，近看每格是一次“提不提经线”的决定。1805 年的纹样册上，有的面板墨点画满，有的只有淡铅笔，是计划了还没落墨的。纱丽织机右边是一串用线缀起来的纹板，一张卡一梭，用过的折到后面去。
关系：64 = 8×8，一份就是一格；这一点两周小倍数已经做了（每帧一个 8×8）。新的只有两处：淡铅笔对落墨，对应“已作答、等下一轮整理”对“已整理”；纹板一梭前进一张、旧卡往后折，可以借给换轮的动画。

**100. 拉班舞谱**（看图：`d-laban-seisolo.jpg`、`d-laban-1.jpg`）
[Commons：Sei solo – courante, Laban score](https://commons.wikimedia.org/wiki/File:Sei-solo-courante_Laban-score.jpg)，[Commons：Labanotation1](https://commons.wikimedia.org/wiki/File:Labanotation1.jpg)。
视觉：六根细高的竖谱表从下往上读，横线切出小节，谱脚菱形框里写小节号；每根谱表中线分开身体左右，往外依次是支撑、腿、躯干、手臂的固定栏，道具另起一栏画在谱表外。每个记号一块：形状是方向，填法（实黑、斜线、中间一点）是高低，长度是时长；蓝色记号只在反复时才做。
关系：事项归属做成固定泳道，外加一个记号叠三个维度。谱表的栏可以给流或负责的 Agent，每件事一块：长度是开了多久，填法是种类，形状是份额涨落的方向。B 与身份线都是一件事一条，没有按负责者分道；条目上没有 actor，只能先按流分道。

**101. 古琴减字谱**（看图：`d-jianzipu-guangling.png`）
[Commons：Guangling San（《神奇秘谱》）](https://commons.wikimedia.org/wiki/File:Guangling_San.png)。
视觉：竖行从右往左读，每个“字”由几个部件拼成：上部是左手指法与徽位数字，中间是弦序，下部的包围结构是右手指法；字旁有双行小注，圈起来的字标段落；曲名和段名用不拆部件的大字。
关系：一个记号里叠几个维度，适合很小的尺寸：外框是种类，内部数字是份额，下部包围是要你做哪类回应，左上小数字是期限。批次记谱只用形状区分一个维度，现有形式里没有复合记号。这是编码而不是新的关系，留给手表与锁屏。

**102. 颜真卿《祭侄文稿》**（看图：`d-jizhi-right.jpg`、`d-jizhi-crop.jpg`、`d-jizhi-left.jpg`）
[Commons：祭侄文稿卷（台北故宫藏）](https://commons.wikimedia.org/wiki/File:%E7%A5%AD%E4%BE%84%E6%96%87%E7%A8%BF%E5%8D%B7.%E5%94%90.%E9%A1%8F%E7%9C%9F%E5%8D%BF.%E7%BA%B8%E6%9C%AC%E8%A1%8C%E4%B9%A6.%E5%8F%B0%E5%8C%97%E6%95%85%E5%AE%AB%E5%8D%9A%E7%89%A9%E9%99%A2%E8%97%8F_(cropped).tif)。
视觉：竖行从右往左。每蘸一次墨，第一个字浓黑，往下五到八个字逐渐变淡，最后成了露出纸色的飞白，整张纸上数得出蘸墨的节奏。写错的字涂成一团墨疙瘩，改的字用小字挤在行旁，有几段被一道长圈圈住。后来几任收藏者的红色印章挤在四边和接缝上，一个也不压正文。
关系：新鲜度。墨色从浓到枯，对应“多久没有新证据喂这件事”，有新输入就像重新蘸墨；现有形式都没有把新鲜度画成连续的衰减。另外两点：涂掉再旁注是就地保留改写；边上的印章是“谁看过”，提示已阅与受众的标记放在边上、不压正文。

**103. 丰田 Deeside 的逐时产出板**（看图：`d-toyota-hourly-board.jpg`）
[AllAboutLean：Toyota hourly tracking of output](https://www.allaboutlean.com/toyota-dashboard-overview/toyota-hourly-tracking-of-output-100/)。
视觉：印好的表格，一行一个时段。目标、投入、产出三栏的每格被一道对角线分开，左上手写本小时数，右下手写累计（75/75、106/181、62/243）。最右几栏的表头是出了故障才竖着手写上去的，对应那一小时的格里写损失分钟（10′、15′）；表头另有一行手写“(2148−537) catch back”。没有找到日本工厂进度管理板的照片，用这张代替“見える化”。
关系：本轮与累计同格，偏差原因按需开列。让位图只画逐轮增减，没有累计；份额为什么动（你的回应、新输入、到期、改写）可以只在第一次出现时开一栏。`reason` 是自由文本，143 条声明里 27 条没写，原因列只能先按回执里的变化类型归类。

**104. 棒针编织图**（看图：`d-knit-chart1.jpg`、`d-knit-chart4.jpg`、`d-knit-chart5.jpg`）
[Anniken Allis：De-mystifying charts](https://annisknittingblog.blogspot.com/2016/08/monday-mini-tip-de-mystifying-charts.html)。
视觉：灰色方格，列号从右往左排，奇数行号写在右边、偶数写在左边，行号在哪边就从哪边读起；红框标出重复单元。圆圈是绕线（加一针），斜线是并针（减一针），同一行里一加一减紧挨着，总针数不变；灰色实心格是“无针”占位，让针数变化时列仍对齐。
关系：守恒下的局部配对。每个加针都在同一行旁边配一个减针，正好是 64 份里“谁让给谁”，但回执里没有这层配对；让位图画了让出与拿到，两边是分开的。灰色无针格可以借来表示“这一轮这件事不在”，身份列不断。

### 看过但没有收入

以下 13 条也下载并看过图，因为与已有条目或形式重叠、结构价值低或会暗示状态里没有的事实，没有编号：NumberFlow 的逐位滚数（手法，拨盘已经在滚数）、Sonner 叠起来的 toast（与 #8 Smart Stack 重叠）、ChatGPT Pulse 的每日卡片（与 #21 Espresso 重叠）、GitHub Agent HQ（普通列表，只作“事项归属”的反例）、盘口深度图（两墙对峙较弱）、均衡箱（与来源矩阵、批次记谱接近）、F1 轮胎 stint 图（与身份线重叠）、加权 Voronoi 树图（外框是拟物的神庙，结构并入 #97）、Hobbs 角度场里的一条曲线（“满屏灰、一条亮线”拨盘与脉冲已用）、Gray-Scott 反应扩散与 d3 蜂群图（会暗示空间相互作用，或与输入颗粒重叠）、马绍尔群岛棒图与算盘（画的是力，或已被拨盘覆盖的守恒）。

## 第四轮候选

从上面 30 条长出的 8 个新 case。每个都先回答“它让人看见哪一种别的形式看不见的关系”；草图是静态的单帧（1440×900，手机 390×844），读 composite f26（8/16 00:00）的真实回放，结绳用手写情境的 f26（composite 两周没有子层），等待链里“谁等谁”是按来源手工标注的。草图与接触表只在本机 scratchpad，不入库，没有接动画，也没有改原型代码。

| 候选 | 它让人看见的关系 | 英雄数字 | 参考 |
| --- | --- | --- | --- |
| 01 拔河 | 哪个生活领域在吃掉预算，以及 Agent 给的份额和你实际动手的地方对不对得上 | 8/13 家里 59 : 工作 5 | #89、#88、#54 |
| 02 蘸墨 | 每件事的证据有多新，而不是它占多少 | rc1 已 6.6 天没有新消息 | #102、#83 |
| 03 驻龄 | 此刻的预算里多少是沉淀的、多少是刚换手的 | 63 份里 19 份是这一轮才给的 | #90、#91、#93 |
| 04 变形 | 输入的量与份额之间，Agent 放大了谁、压小了谁 | master CI 149 条 → 6 份；主水管 29 条 → 24 份 | #96、#92、#75 |
| 05 等待链 | 谁在等谁、你挡住了谁 | 9 人在等你 | #77、#82 |
| 06 结绳 | 层级份额与分组合计 | 最深一层折合根层 0.21 份 | #98、#97、#80 |
| 07 峰值保持 | 你离开期间升起又落下、此刻已经看不出来的事 | 3 件；猫看病 12 → 24 → 6 | #86、#88、#87、#91 |
| 08 回应托盘 | 每个问题要你付出多少 | 6 下答完 5 个问题 | #78、#75 |

**01 拔河**
关系：家里与工作在 64 份里此消彼长，以及你在来源处实际在哪边动手。小倍数按身份着色，看不出领域之间的拉锯；现有形式也没有把“Agent 给的”和“你做的”并排。
英雄数字：此刻 40 : 23（家里 : 工作）；标题给两周的极值，8/13 00:00 家里 59 份、工作 5 份。
第一眼：左边一根 64 份高的评估条，上白（工作）下黑（家里），中间一道斜线是留白，条旁写每件事的份数；右边一条两周的评估曲线，中线是持平，墨色面向下鼓起是家里领先，8/12–8/14 深深坠下，8/14 12:00 一下弹回；曲线下方一排朱红短柱，上是你在工作上的回应、下是家里的，8/7 00:00 那一轮份额家里 39 : 工作 25，你却在工作上动了 13 次、家里 1 次。
数据：流按事项出处推断（生活问答并入家里），回应按反馈链接计。

**02 蘸墨**
关系：每件事多久没有新证据，墨色从浓到枯；有新输入就像重新蘸墨。已有形式只画份额与期限，新鲜度从没被画成连续的衰减。
英雄数字：6.6 天（rc1 最后一条消息在 8/9 09:30）；此刻 14 件里 6 件已经一天以上没有新消息，合计 11 份。
第一眼：一件事一竖行，从右往左按名次排，行宽是份额；行首是竖排的名字，墨色就是新鲜度，右边的主水管、master CI 墨黑，左边的 rc1、开学文件已经发灰；下面是过去 7 天的竖带，每来一条输入墨色回到最黑，朱红细线是你本人的输入。
数据：被采用的相关输入与来源的时刻；衰减按 e^(−小时/30) 平涂，不仿纸。

**03 驻龄**
关系：份额的年龄，此刻的 64 份里每一份已经在当前这件事上连续待了几轮。让位图只画这一轮谁涨谁缩，小倍数要逐帧翻，都看不出“沉淀”。
英雄数字：19 / 63，这一轮新给了 19 份；6 份从第一轮（8/3 12:00）起就没挪过。守恒写在旁边：让出 8 份 + 留白减 11 份 = 新给的 19 份。
第一眼：一张 8×8 的 Molnár 式方格，一格一份，格里同心方框的圈数就是待了几轮，从第一轮起一直在的格子是实心黑；主水管的 24 格里大半只剩一道外框，右下几格实心；右栏按名次列每件事的格子年龄。
数据：每件事最近连续几轮的最小份额，按格从老到新排。

**04 变形**
关系：Agent 的判断本身。同一批事项留在原位，从“收到多少条输入”变形成“占多少份”。来源矩阵数来源，整理脉冲把输入汇到根上，没有一种让两种量在原地互换。
英雄数字：149 → 6（master CI），29 → 24（主水管）。
第一眼：两块并排的圆阵，位置相同、面积不同：左边最大的是白色的 master CI 圆（149 条），右边最大的是黑色的主水管圆（24 份）；动画里左图原地胀缩成右图，草图把两拍并排。黑是家里、白是工作，与拔河一致。
数据：两周按 `relatedIds` 关联到此刻 14 件的 452 条输入（总共 3051 条），同一件事换过 id 不合并。

**05 等待链**
关系：谁在等谁、你挡住了谁。现有形式只知道“问题开着”，不知道问题后面站着谁、答了之后谁才能动。
英雄数字：9 人在等你（Kajsa 一个人挂在三件事上）；最久的是 6B 班主任，5.4 天。
第一眼：一根朱红竖脊上排着七个“你”，每件事一行；左边是等你的人，离脊越远等得越久（对数距离），线上写小时数；右边是你答了之后才能动的下一环（水管工周二开工、#13587 关闭），带期限的写“期限还有 34 时”。底部灰着两条不经过你的链（Edith 等报告者、大家等 windy-drift）。
数据：状态里没有依赖字段，链由 f26 的来源与问题文字手工标注，草图上注明“示意”；做成形式需要契约增加“谁在等”的字段或由 Agent 写出。

**06 结绳**
关系：层级份额与分组合计。一件事里还有自己的 64 份；第二轮记下这个缺口，至今只画根层。
英雄数字：0.21 份，手写情境 f26 里最深的一件（发布 → 旧机验证 → 回滚开关）在子子层占 6/64，折合根层只有 0.21 份；发布 24 份往下的子层 64 份只用了 12。
第一眼：一根粗主绳横过上方，八根垂绳挂下来，结按十位（单结）和个位（长结的圈数）对齐成两道横带；有子层的垂绳在中段分叉出副绳，副绳上有自己的结和折合根层的“≈2.3”；主绳上方两根合计绳分别记工作组 55、家里组 6。平涂线与几何结，不仿绳的质感。
数据：story 数据集 f26 的真实子层；点开一根垂绳可以借 #80 的过渡长成子层画框。

**07 峰值保持**
关系：上次接触锚点之后的起落，你不在的时候升起又落下、此刻已经看不出来的事；峰值一直停着，直到你按“已阅”。
英雄数字：3 件在你离开的 6 轮里升起又落下（猫看病 12 → 24 → 6，复用绕过 0 → 6 → 0，骑车 0 → 3 → 0）。
第一眼：一排竖向电平表，一件事一根：实心是此刻，粗横线停在离开期间的最高处，表头黑框里写峰值，虚线是你上次看时；峰值旁的圈号按分段谱的办法从你离开后重新编号（猫看病在第 2 轮到峰）；左下一枚朱红描边的“已阅 · 清掉峰值”。
数据：锚点手选 f20（8/13 00:00），因为 `last_seen_at` 恒为 null；只画三个时刻：上次看、离开期间最高、此刻。

**08 回应托盘**（手机）
关系：回应的分量，每个开着的问题要你做几下。D 把所有问题排成同样的卡片，看不出哪些一下就完。
英雄数字：6 下答完 5 个问题，其中 4 个点一下就完，“三个旧 PR 推到哪天”要先点“推到…”再挑日子。
第一眼：390×844 的竖屏，上方一个大“6”，下面五个圆角托盘按档位与期限叠成一列，托盘高度只随作答步骤变：确认类只有一个按钮，最矮；推后的托盘带一排日期，最高；右栏写每个托盘最少几下。朱红方块只标登记了的问题。
数据：f26 五个登记中的问题与它们的 `expects` 和按钮；“几下”按 confirm、approve、choose 各 1 下，defer 2 下估计。
