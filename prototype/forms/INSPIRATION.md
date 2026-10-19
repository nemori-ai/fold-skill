# 表达形式的灵感来源

状态：2026-10-14 为“拓展表达形式”收集的外部参考，只服务原型构思，不是产品规范。概念与取舍见 [CONCEPTS.md](CONCEPTS.md)，原型入口见 [画廊](index.html)。

每条写三件事：来源、它怎样分配或保护注意力、对 Fold 的启发。标“看图”的条目，图片已下载到本地 `.local/inspiration/`（不提交）并逐张看过，另写从画面上读到的视觉手法；标“仅文字”的条目没有找到可用图片，或站点拒绝了无头浏览器。第一轮共 42 条，其中 26 条看过图。第二轮（#43 起）只找结构的画法，30 条全部看过图，图片在 `.local/inspiration-r2/`，每条另写它对应状态里的哪一种关系。

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
整理脉冲取了三点：步骤名硬切、不缓动；底部流水线框住当前一格，与主图的节拍同一帧变；一条亮线穿过密集的群体，标出“这一刻被运走的是哪几个”，对应采用的事件飞进枝里。
