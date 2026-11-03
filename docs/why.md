---
title: 为什么要做 Fold
description: 从头读到尾的一篇：Agent 看见的没有上限，人每一刻看得过来的有，而且随处境在变。用一个人的两周，讲 Fold 为什么要做、怎么做、做到了哪。
layout: page
sidebar: false
aside: false
outline: false
pageClass: fold-why
---

<!-- 状态：给第一次了解 Fold 的人从头读到尾的说明，不是规范出处。十四段沿用原 16 页小册子的故事线，每段至少一张图，
     只看图和图注也能顺下来。版式在 site/.vitepress/theme/why.css；标题与引句用 Fold Serif SC 子集，改了字要重跑
     node scripts/landing-fonts.mjs。图在 docs/assets/why/：d-*.webp 是按演示数据画的示意，其余是原型截图，
     例子取自默认演示数据 founder（陆晨的两周，作者编写）的 f22（9 月 18 日零点）；重画与重拍用 node scripts/why-figures.mjs，
     见 docs/development.md「为什么要做 Fold」。 -->

<article class="fw">

<header class="fw-head">
<div class="fw-title">
<p class="fw-kick">从头读起</p>

# 为什么要做 Fold

<p class="fw-lede">Fold 替一个人整理 Agent 看到的一切，只给他此刻最值得看、也看得过来的那部分。下面用一个人的两周，分十四段讲它为什么要做、怎么做、做到了哪。读完约十分钟。</p>
</div>

<figure class="fw-fig is-cover" style="--max: 360px">
<a class="fw-shot" href="../prototype/index.html?variant=d&amp;frame=22" target="_self" data-vp-ignore><img src="assets/why/phone-f22.webp" width="640" height="684" loading="lazy" decoding="async" alt="原型的手机首页，9 月 18 日零点：大字写 7 件等你回应，下面一行说上次看过之后收到 169 条；第一张卡问明早见客户，国庆前能不能答应把 AI 接不了的电话转到店里手机，三个按钮。"></a>
<figcaption>9 月 18 日零点。陆晨忙了一下午加一晚上，这半天进来 169 条。他掏出手机，第一屏只说：7 件等你回应，排在最前的是明早十点见客户。</figcaption>
</figure>

<nav class="fw-toc" aria-label="本篇十四段">

1. [有尽头的通知](#notifications)
2. [一百多条里的两件](#two-of-many)
3. [头版只有那么大](#front-page)
4. [陆晨的两周](#two-weeks)
5. [大体判得对](#mostly-right)
6. [错在轻重](#where-it-errs)
7. [同一场比赛](#same-game)
8. [抬腕一眼](#glance)
9. [坐到桌前](#desk)
10. [什么时候到期](#when)
11. [回头看两周](#review)
12. [按下之后](#after-answer)
13. [亲手试一下](#try)
14. [做到了哪](#where-we-are)

</nav>

</header>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">01 · 问题从哪来</p>

## 有尽头的通知 {#notifications}

</header>
<div class="fw-body">

你手机上有几个 App 会给你发通知？

每一个都有尽头。学校一周发几条通知，银行只在扣款时响一声，携程只在订票和航班改时间时来消息。每个 App 只管自己的事，事情有多少，消息就有多少。

排先后的一直是你。孩子发烧比群里的闲聊要紧，家里漏水比订阅的周刊要紧。没有哪个 App 替你排，因为没有哪个 App 看得见别的 App。

Agent 不一样。你让它替你看着工作、家里的群、孩子的学校、银行和订阅，它就全看着。它不累，也不漏，来源只会越加越多。

<figure class="fw-fig">
<div class="fw-shot"><img src="assets/why/d-notifications.webp" width="928" height="862" loading="lazy" decoding="async" alt="示意图。上半部分四行：学校的通知、银行、宠物医院、携程，两周里各只有几道竖线，分别是 8、30、11、14 条。下半部分是 Agent 看着的全部：每半天一列、一条一个点，两周 2532 条、67 个渠道，少数点是朱红。右下角一个小圆写着 5 件要紧，旁边说你某一刻看得过来的，抬腕看一眼，只有这么一小块。"></div>
<figcaption>以前每个 App 只管自己的事，两周也就几条到几十条。现在 Agent 同时看着全部，两千五百多条；你抬腕看一眼，只看得过来一小块。</figcaption>
</figure>

> 它看见的没有上限，你看得过来的有。

你看得过来多少，还要看你在做什么。骑车时只能瞄一眼手表，坐在电脑前能多看一些，周末停下来复盘，才有工夫从头看到尾。

所以排先后这件事，第一次可以交给别人做，也只能交给别人做。总有一刻，Agent 得替你决定，哪些先不给你看。

它该给你看哪些？

</div>
</section>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">02 · 为什么难</p>

## 一百多条里的两件 {#two-of-many}

</header>
<div class="fw-body">

演示里有一个虚构的人，叫陆晨。他和朋友开了一家 7 个人的公司，做给小店接电话的 AI；家里有妻子、两个孩子、一只狗。

9 月 17 日，他从中午一直忙到半夜，这半天进来 169 条。第二天上午要定的有好几件，最难的是两件：十点见客户，国庆前能不能答应把 AI 接不了的电话转到店里；妻子出差回不来，九点半狗打疫苗，谁带去。

<figure class="fw-fig">
<div class="fw-shot"><img src="assets/why/d-half-day.webp" width="928" height="624" loading="lazy" decoding="async" alt="示意图：9 月 17 日中午到半夜的 169 条，每条一道竖线，按工作、社区、订阅、生活、家里分五行，横轴从 12:00 到 24:00。大多是灰的，少数是黑的；朱红的在两处：工作那一行从下午两点到夜里十一点的四十来条，上面的括号标着明早见客户、转接答不答应；家里那一行傍晚以后的六条，下面的括号标着明早狗打疫苗、谁带去。"></div>
<figcaption>那半天的 169 条，一条一道竖线，按来源分行。灰的没用上，黑的用上了；跟那两件事有关的是朱红的：客户那件在工作群里来回了四十来条，狗那件只有家里的六条。</figcaption>
</figure>

难在把这两件挑出来。看其中几条，和 Agent 怎么处理：

| 进来的 | Agent 的处理 |
| --- | --- |
| 同行群里有人发红包，“求个好彩头” | **噪音。** |
| 订阅号的长文：今年最热闹的语音话题 | **噪音。** 他做的正是语音，可这篇和明天无关 |
| 实习生问：告警合并以后，昨晚那种一分钟一张的就没有了吗？ | **先放下。** 不急，明天的会更要紧 |
| 一位店长在客户群里问：国庆值班，打店里座机还是手机？ | **用上。** 明早见客户，要答的正是这件 |
| 妻子：明天狗打针你带去吗，我回不来 | **用上。** |

写得认真的长文被放下，店长随口问的一句却用上了。实习生那个问题，换一个不忙的下午就该回。

规则做不了这件事。它认得出机器人和“收到”，认不出“写得认真，但和你无关”。

> 要不要紧，不在消息本身，在这个人、这一刻。

还有两处让它更难。**放下的不能凭空消失。** 没给你看的，你得信得过，所以每一条都要有去处，说得出为什么。**你看得过来的量在变。** 同一张清单，放在手表上太长，放在桌前又太短。

谁来判断？判断写在哪里？

</div>
</section>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">03 · 第一个判断</p>

## 头版只有那么大 {#front-page}

</header>
<div class="fw-body">

报纸的头版只有那么大。

每天的稿子远多于版面。编辑的活儿就是取舍：哪条上头版，占多大，哪条放进内页，哪条不登。版面不会变大，变的只是取舍。

Fold 让 Agent 当这个编辑。每半天，它读完新进来的全部，重排一份头版：眼下有哪几件事，每件占多大，哪几件在等你拿主意。每一条消息都记下去处，用上、先放下、噪音或重复，再附一句理由。

<figure class="fw-fig">
<div class="fw-shot"><img src="assets/why/d-front-page.webp" width="928" height="928" loading="lazy" decoding="async" alt="示意图：报纸样式的“陆晨的头版”，9 月 18 日零点，17 件、7 件等你。左上一大块：明早见客户，国庆前能不能答应把电话转到店里，等你选、明早十点，24 份。右上四小块各 6 份：女儿的秋游回执、赞助商要上台 15 分钟、开源库的新版本周五发不发、狗打疫苗谁带去。下面两格各 3 份，十件小事各占一小格。等他回应的几件标着朱红小点。"></div>
<figcaption>9 月 18 日零点的头版。明早见客户占一大块，回执、赞助、新版本、打疫苗各占一小块，十件小事各占一小格。朱红的是在等他回应的。</figcaption>
</figure>

**判断交给模型。** 只有读懂了，才分得出店长随口问的一句和订阅号的长文谁轻谁重。这一步，以前只有人做得了。

**边界交给规则。** 版面多大是固定的。放不下，整份退回，写明超了多少；先撤哪件，由它自己定。规则只换算、检查、记账，不替它拿掉任何一件。

<figure class="fw-fig">
<div class="fw-shot"><img src="assets/why/d-returned.webp" width="928" height="484" loading="lazy" decoding="async" alt="示意图，三块方格版面从左到右。第一块：新版本放大一倍，有 6 份伸出版面外。第二块：同样的版面变淡，中间写着整份退回，下面说规则一份也不替它挪，只写明超了多少。第三块：它自己撤下 6 件小事，再交，正好排满，收下。"></div>
<figcaption>示意。它想把新版本放大一倍，版面超了 6 份。规则整份退回，一份也不替它挪；它自己撤下 6 件小事，再交，才收下。</figcaption>
</figure>

版面固定，取舍才是真的：多放一件，就有一件要变小。不固定，这份头版很快会变成另一个收件箱。

原型里，版面切成 64 份，一件事占几份，就画多大。64 只是演示选的数，可以改。

这份头版，在 Fold 里叫“状态”。它排得准吗？要回答，先得有一份像真的两周。

</div>
</section>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">04 · 用什么数据</p>

## 陆晨的两周 {#two-weeks}

</header>
<div class="fw-body">

手写的例子太干净。真实的收件箱里，大多数消息写得认真，却和你无关。

陆晨的两周是作者写的，人物和每一条消息都是编的，不来自真实的人。噪音的多少却照真实数据量过：群里的“收到”、重复的报警、广告和推送，别人发给他的消息，差不多三条里有两条不用他理。

主线是第一个大客户。一家连锁口腔诊所的九家店，9 月 15 日改由 AI 接电话；第二天晚上出了故障，有一阵电话没接起来，客户要他周五上午给个说法。

主线之外，他业余维护的一个开源库要发新版，和朋友合办的开发者聚会在找赞助。家里都是平常事：妻子出差三天，女儿的秋游回执要签，儿子周三晚上要去游泳馆接，狗要打疫苗。

<figure class="fw-fig">
<div class="fw-shot"><img src="assets/why/d-two-weeks.webp" width="928" height="724" loading="lazy" decoding="async" alt="示意图：五路来源的说明与条数，家里 371、生活 188、工作 1520、社区 330、订阅 123；下面是两周每半天一列的堆叠柱，工作占了大半，9 月 16 日晚那一列最高。最下面两条横条：进来的消息里家里和生活约占五分之一，要他回答的问题里家里和生活占一半。"></div>
<figcaption>两周，每半天一列，五路来源。工作和社区占了四分之三；家里和生活的消息约占五分之一，要他回答的问题却有一半在这边。</figcaption>
</figure>

作者知道结局，写出来容易太顺。所以每条线都故意留了岔子：店长回的“已设置”，其实转到了前台的旧手机；会改到上午十点，邀请邮件还写着下午两点；宠物医院的提醒短信，把狗写成了“猫三联”。

数据有了。让真实的模型跑一遍，会怎样？

</div>
</section>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">05 · 判得怎么样</p>

## 大体判得对 {#mostly-right}

</header>
<div class="fw-body">

我们让真实的模型从一张白纸开始，每半天整理一次，连跑两周。

28 轮，每一轮都交上了一份合规的头版，一次也没被退回。

可第 2 轮几乎是白卷。那半天进来 102 条，它只判了 4 条，什么也没改，照样被收下。漏掉的里面有陆晨自己发到群里的切换清单，九家店改由 AI 接电话之前谁做什么，都在上面；之后十一轮，它一直以为清单没发。规则查得出版面超没超，查不出它这一轮没干活。

哪些是噪音，它大体判得对。作者写这两周时，也写下了每条消息该不该理。拿这份答案对照：它判成噪音的，十条里九条多作者也这么判；作者判成噪音的，它只认出一半多，其余的大多留了下来。

<figure class="fw-fig">
<div class="fw-shot"><img src="assets/why/d-runs.webp" width="928" height="570" loading="lazy" decoding="async" alt="示意图：一行 28 个方块，每一轮都交上了一份合规的头版，第 2 个是空心的，标着几乎白卷，也收下了。下面两行各十个圆：它判成噪音的十条里，九条多作者也判成噪音；作者判成噪音的十条里，它认出五条多，其余的大多留了下来。"></div>
<figcaption>一遍，28 轮，一次也没被退回，第 2 轮几乎是白卷。它扔掉的大多该扔；该扔的，它只扔了一半多。</figcaption>
</figure>

这样对照，量的是它和作者想得一不一样，不是它对不对。

在上一份数据（化名改写的真实公开文本）上跑过三遍，在一组手写的例子上逐条对过作者的答案，结论也差不多：该不该用，大多判得一样；轻重，常常差一档。

格式守得住，扔掉的大多该扔。那它错在哪？

</div>
</section>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">06 · 错在哪里</p>

## 错在轻重 {#where-it-errs}

</header>
<div class="fw-body">

妻子出差回不来，狗明早九点半打疫苗，离十点见客户只差半小时，今晚就得定谁带去。它给了 6 份，和女儿的回执、赞助商一样大；作者觉得这件该再大一档。

一条证书到期的提醒，每天早上来一次，到时候续上就行。第一轮它给了 12 份，排在第二，比家里电饭煲坏了还大；之后十几轮，它一直占着 3 份。

<figure class="fw-fig">
<div class="fw-shot"><img src="assets/why/d-mistakes.webp" width="928" height="560" loading="lazy" decoding="async" alt="示意图，两组横条，每条是那一轮的整份头版，黑色一段是这件事。狗打疫苗：它给了 6 份，和回执、赞助、新版本一样大；作者那条只画见客户和这件，高一档是 12 份，仅次于见客户。证书到期的提醒：第一轮它给了 12 份，排在第二；第十轮还占着 3 份。"></div>
<figcaption>两处差一档。狗打疫苗只给了 6 份，作者觉得该有 12 份；例行的证书提醒第一轮就给了 12 份，之后一直占着地方。</figcaption>
</figure>

> 错的不是格式，是轻重。

上一份数据里，家里的事普遍高一档；这一份里反过来，家里的事常被排低。注意力往哪边偏，换个条件就会变。

这正是难的地方，也是接着要做的地方。演示用的就是这一遍的结果。判断上我们只手改了一处，就是第 2 轮漏掉的那份清单；上面两处都没改。改了什么、为什么，都有[记录](../prototype/data/founder/POLISH.md)。

头版排好了。可人不会总坐在桌前读它。

</div>
</section>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">07 · 第二个判断</p>

## 同一场比赛 {#same-game}

</header>
<div class="fw-body">

同一场球赛，开车时听广播，在家看直播，第二天看集锦。

比赛是同一场，讲法不同。广播只说比分和谁进了球；直播什么都给；集锦只留下改变比分的那几分钟。讲法跟着你能分出多少注意力走。

这份注意力，我们叫它带宽：这一刻一眼读得下多少，能看多久，手上能做什么。

Fold 的第二个判断：同一刻的头版，按此刻的带宽重新编排。不是把一张大图缩小。挑哪些，按什么顺序，画成什么样，都要重来。

<figure class="fw-fig">
<div class="fw-shot"><img src="assets/why/d-windows.webp" width="928" height="848" loading="lazy" decoding="async" alt="示意图：9 月 18 日零点的同一份头版，画进四扇大小不同的窗。抬腕两秒：一个圆，写 5 件要紧、转接答应吗。掏手机一分钟：竖长的窗，7 件等你，两张带按钮的卡。坐到桌前几分钟：整份版面按面积铺开，客户那件一大块。周末复盘半小时：一扇宽窗，两周每一轮一根柱，最后一根是此刻。"></div>
<figcaption>同一刻，四扇窗。抬腕两秒，只数要紧的；掏出手机一分钟，等你回应的排成卡片；坐到桌前几分钟，整份头版铺开；周末复盘半小时，只看两周的走向。</figcaption>
</figure>

原型一共试了二十多种读法，都是表现层上的尝试，读的是同一份回放。下面挨个看其中几种。

抬腕那两秒，该看到什么？

</div>
</section>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">08 · 回来一眼</p>

## 抬腕一眼 {#glance}

</header>
<div class="fw-body">

手表只回答一个问题：要不要现在掏手机。

表圈上的刻度是整份头版，中间的数只数要紧的事：一天之内到期，或者特别重。9 月 18 日零点是 5 件，回执、打疫苗、见客户、赞助、新版本，都在明天。表上写最重的那件：十点前，答应国庆前加转接吗。

表上只答得了简单的：签个字，二选一。转接这件是三选一，表上不硬塞，只说“这件在手机上答”，再给一个“1 小时后再提醒”。

<div class="fw-pair" style="--max: 624px">
<figure class="fw-fig" style="--a: 0.8255">
<a class="fw-shot" href="../prototype/forms/watch.html?frame=22" target="_self" data-vp-ignore><img src="assets/why/watch-face-f22.webp" width="700" height="848" loading="lazy" decoding="async" alt="腕上一瞥的表盘：一圈刻度，中间大字 5，下面写件要紧，再下面两行是最重的那件：十点前，还有 10 小时，答应国庆前加转接吗。"></a>
<figcaption>抬腕：5 件要紧，最重的一件写成一句话。</figcaption>
</figure>
<figure class="fw-fig" style="--a: 0.8255">
<a class="fw-shot" href="../prototype/forms/watch.html?frame=22" target="_self" data-vp-ignore><img src="assets/why/watch-reply-f22.webp" width="700" height="848" loading="lazy" decoding="async" alt="腕上一瞥的回应屏：十点前还有 10 小时，答应国庆前加转接吗；中间写着这件在手机上答，选项不止两个；下面两个按钮：在手机上打开、1 小时后再提醒。"></a>
<figcaption>点开：三选一在表上答不了，就交给手机。</figcaption>
</figure>
</div>

掏出手机，就是开头那一屏：顶上一句先说几件在等你，最急的几件排成大卡，按钮上写明怎么答。

坐到桌前，有几分钟呢？

</div>
</section>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">09 · 在电脑前</p>

## 坐到桌前 {#desk}

</header>
<div class="fw-body">

坐到桌前，可以把整份头版铺开。

格子的面积就是分量。明早见客户占一大块，回执、赞助、新版本、打疫苗各占一小块。不需要他做什么的小事，合成一格“另有 8 件小事”，点开再看。

<figure class="fw-fig" style="--max: 434px">
<a class="fw-shot" href="../prototype/index.html?frame=22" target="_self" data-vp-ignore><img src="assets/why/desk-f22.webp" width="868" height="916" loading="lazy" decoding="async" alt="原版的桌面版面，9 月 18 日零点：7 件等你回应、共 17 件、已用 64 份。客户那件占左上一大块，右边一窄条是女儿的秋游回执，中间一排是赞助、开源库的新版本、狗打疫苗，下面几格小事，右下一格写另有 8 件小事，各占 1 份。"></a>
<figcaption>桌前的版面。面积就是分量，红点是在等他回应的，八件小事合成一格。</figcaption>
</figure>

旁边一栏列着在等他的 7 个问题，每个都写着几点前要答。

这块版面只说此刻。哪件事什么时候到期？

</div>
</section>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">10 · 什么时候</p>

## 什么时候到期 {#when}

</header>
<div class="fw-body">

有些事，要看的不是多重，是什么时候。

一种读法把期限画在“此刻”这条线的右边。女儿的回执还有 8 小时，打疫苗和见客户都在 10 小时上下，赞助商的答复要在中午前，谁先到一眼就看得出；过了期限的，写明过了多久。

另一种把每件事画成一滴水，越重越大。你把一件事推到傍晚六点，它就沉到水面以下，到点再浮上来。

<div class="fw-pair" style="--max: 760px">
<figure class="fw-fig" style="--a: 0.6761">
<a class="fw-shot" href="../prototype/index.html?variant=b&amp;frame=22" target="_self" data-vp-ignore><img src="assets/why/time-f22.webp" width="860" height="1272" loading="lazy" decoding="async" alt="时间展开，9 月 18 日零点：中间一根竖线是此刻，左边是前几轮的份额带，右边是期限。客户那件 24 份，10 小时后；女儿的回执 6 份，8 小时后；赞助、打疫苗、新版本各 6 份，各自标着几点前；最下面是 10 件小事。"></a>
<figcaption>零点：期限画在此刻之后。女儿的回执 8 小时后到期，最近。</figcaption>
</figure>
<figure class="fw-fig" style="--a: 0.6232">
<a class="fw-shot" href="../prototype/index.html?variant=c&amp;frame=22" target="_self" data-vp-ignore><img src="assets/why/defer-f23.webp" width="860" height="1380" loading="lazy" decoding="async" alt="流动形态，9 月 18 日中午：几件等你回应，你推后的 1 件沉在水面以下。上面几滴大小不同的水珠，客户那一滴缩成 12；底部水面以下一排小珠，右下角一颗推后的珠子标着 18:00，到点浮起。"></a>
<figcaption>中午：推后的那件沉在水下，标着 18:00；客户的会开完了，那一滴缩小了一半。</figcaption>
</figure>
</div>

一刻一刻地看，看不出两周里发生了什么。复盘时看什么？

</div>
</section>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">11 · 复盘</p>

## 回头看两周 {#review}

</header>
<div class="fw-body">

复盘不收作答，只回答一件事：这两周是怎么过的。

每半天一张小方阵，按日排开。哪件事什么时候变大、什么时候消失，一眼就看得出：9 月 17、18 日，故障与年单（绿）占了大半；18 日中午会开完，它缩小一半；到了周末，开源库的新版本（黄）升到最上面。

旁边记着每件事的起落，也记着每个问题怎样关上：有的是他答了，有的换成了新问题，有的是事情变了，问题跟着撤下。

<div class="fw-pair" style="--max: 660px">
<figure class="fw-fig" style="--a: 0.5635">
<a class="fw-shot" href="../prototype/forms/multiples.html?frame=22" target="_self" data-vp-ignore><img src="assets/why/review-week2-f22.webp" width="612" height="1086" loading="lazy" decoding="async" alt="两周小倍数的一段：9 月 17 日到 20 日，每天两张八乘八的小方阵。17、18 日绿色占了大半，18 日零点那一张被框出；18 日中午绿色缩小，19、20 日黄色升到最上面。"></a>
<figcaption>9 月 17 日到 20 日，每半天一张方阵；框出的是 18 日零点。</figcaption>
</figure>
<figure class="fw-fig" style="--a: 0.6061">
<a class="fw-shot" href="../prototype/forms/multiples.html?frame=22" target="_self" data-vp-ignore><img src="assets/why/review-trend-f22.webp" width="700" height="1155" loading="lazy" decoding="async" alt="两周累计份额最多的八件事的走势线：九店上线、开发者聚会、故障与年单、开源发版等，右边是此刻的份额；下面列出此刻开着的 7 个问题里的 5 个，和 1 个刚换成新问题的。"></a>
<figcaption>两周分量最多的几件事怎样起落，和此刻开着、刚关上的问题。</figcaption>
</figure>
</div>

问题关上，多半靠他的回答。可按下一个按钮，事情就办了吗？

</div>
</section>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">12 · 回答之后</p>

## 按下之后 {#after-answer}

</header>
<div class="fw-body">

在手机上按下“28日前上线”，事情办了吗？

没有。按下，只是记下了你的回答。Agent 下一轮整理读到它，才算收到。客户答不答应，要从之后的消息里看出来。

> 保存、收到、办成，是三件事。

<figure class="fw-fig">
<div class="fw-shot"><img src="assets/why/d-receipts.webp" width="928" height="946" loading="lazy" decoding="async" alt="示意图，从上往下：一张问题卡，明早见客户，国庆前答应加转接吗，三个按钮。第一步他在手机上按下 28日前上线，回执写已保存，只记在这一页，头版还没变。第二步中午下一轮整理，回执写已收到。第三步同一轮它还读到两条消息：11:30 客户说合同加一条 28 日前上线转接，11:53 他在全公司群里说谈下来了、下周一盖章；这件从 24 份缩到 12 份，写着办成。"></div>
<figcaption>同一个回答的三步。按下时只是保存；下一轮整理读到，才算收到；客户的话和他在群里的那句进来，才算办成。</figcaption>
</figure>

所以 Fold 留着的是头版，不是一条条通知。一件事开着，就一直在头版上占着地方，直到之后的消息说明它变了。

而人多半不会回到 Fold 里来答。演示里，他的回答都发生在原处：在群里回一句，发一封邮件，直接打电话。9 月 18 日上午十点，陆晨去见了客户，十一点半客户在微信里说：合同加一条，28 日前上线转接。下一轮，Agent 读到这条，客户那件才缩小一半，改成“白鹭年单谈成，周一盖章”。

Fold 得认得出这样的回答。开头那张卡上那行“你在飞书上回复了郑婉”，就是它从原处认出来的：他把方案发给了合伙人，可客户还没答复，问题还开着。

光看不如试一下。

</div>
</section>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">13 · 试一下</p>

## 亲手试一下 {#try}

</header>
<div class="fw-body">

原型就是这份回放本身：两周，28 轮，可以一轮一轮往前走。

<figure class="fw-fig" style="--max: 329px">
<a class="fw-shot" href="../prototype/index.html?variant=d&amp;frame=22" target="_self" data-vp-ignore><img src="assets/why/try-f22.webp" width="700" height="1494" loading="lazy" decoding="async" alt="手机首页的原型，9 月 18 日零点，按下 28日前上线之后：顶上变成 6 件等你回应，客户那张卡收成一行回执：你选了 28日前上线，已保存，等 Agent 下一轮整理，状态还没变，右边是撤回；下面是女儿秋游回执的已签好和狗打疫苗的三选一。"></a>
<figcaption>按下“28日前上线”，那张卡收成一行回执：已保存，等 Agent 下一轮整理。</figcaption>
</figure>

<p class="fw-try"><a class="fw-btn" href="../prototype/index.html?variant=d&amp;frame=22" target="_self" data-vp-ignore>亲手试一下 ↗</a><span>回到 9 月 18 日零点。按下一个答案，再往前走一轮，看回执从“已保存”变成“已收到”。作答只记在你的浏览器里。</span></p>

看完这些，Fold 走到了哪一步？

</div>
</section>

<section class="fw-sec">
<header class="fw-rail">
<p class="fw-no">14 · 现在在哪</p>

## 做到了哪 {#where-we-are}

</header>
<div class="fw-body">

**已经有的。**

- 一套设计：Agent 交什么，规则怎么守，状态怎么存。写在[信息契约](information-contract.md)和[架构](architecture.md)里。
- 规则那一半的第一段：在内存里跑通，用[一致性用例](../conformance/cases)逐条检查“超了就整份退回”这类规则。
- 给 Agent 的[判断指引](../skill/SKILL.md)，第二版，在两份数据上跑过：一份是化名改写的真实公开文本，一份是作者编写的这两周。结果见[评测报告](evaluations/README.md)。
- 二十多种读法的[原型](../prototype/README.md)，读的是同一份回放。

**还没有的。** 能装上就用的产品：命令行和接进 Agent 的 skill 都还没做。原型不连真实账户，按下的回答只记在你的浏览器里。

**还缺的。** 头版里还缺几样东西：一件事改了名，怎样认出还是同一件；一个问题什么时候算关上；一件事变大了，是谁给它腾出的地方。这些都记在[未决问题](decisions.md#未决问题)里。

**怎样算有用。** 最后只问一件事：一个人离开半天回来，能不能很快认出要自己处理的事，少漏，也少被打扰。

<figure class="fw-fig">
<div class="fw-shot"><img src="assets/why/d-ladder.webp" width="928" height="624" loading="lazy" decoding="async" alt="示意图：五级证据从下往上。已经有的三级：规则守得住，超了就整份退回；逐帧对照作者的答案，它判成噪音的十条里九条和作者一样；两份数据跑下来，四遍每一轮都交上了合规的头版，有一轮是白卷。还没有做的两级：同样的条件多跑几遍，看稳不稳；让真人来读、来用，离开半天回来能不能很快认出要自己处理的事，这是最后要回答的问题。"></div>
<figcaption>证据从下往上。规则守得住、逐帧大体判得对、两周跑得下来，已经有了；多跑几遍看稳不稳、让真人来读来用，还没有做。</figcaption>
</figure>

现在的证据，是拿作者写下的答案、拿真实数据里那个人后来做了什么去对照。让真人来读、来用，是下一步。

<nav class="fw-more" aria-label="接着读">

- [全部原型](../prototype/all.html)：所有读法排在一页里
- [产品方向](product.md)、[用户故事](user-stories.md)：人怎样用它
- [信息契约](information-contract.md)：精确的规则
- [陆晨的两周怎样写成](../corpus/founder/README.md)：人物、主线、噪音与检查

</nav>

</div>
</section>

<footer class="fw-foot">

陆晨是虚构的人物。他的公司、客户、家人和两周里的每一条消息都由作者编写，不来自真实的人，见[语料说明](../corpus/founder/README.md)和[演示数据的来源](../prototype/data/founder/SOURCES.md)。上一版的例子是化名人物 Jonas 的两周，取自化名改写的真实公开文本，[在原型里仍能切过去看](../prototype/index.html?data=composite)，来源与许可见[真实语料](../corpus/README.md)。

这一篇讲为什么，不是规范出处：精确规则以[信息契约](information-contract.md)为准，范围与次序以[决策记录](decisions.md)为准。

</footer>

</article>
