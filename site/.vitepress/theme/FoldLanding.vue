<script setup>
// The landing page (site/index.md, layout: FoldLanding). Story, numbers and look: site/landing/{story,style,spec}.md.
// Every number comes from site/landing/data.json (the f26 replay); elements that show one carry data-k="<path>"
// so scripts/check-landing.mjs can hold them to it.
//
// Motion: the first screen plays once with CSS only (it starts on first paint, before any script; the times are
// landing.mjs's MOMENT) and stops on its last situation; a tap on a situation switches it with transitions. The
// three beats of the fourth section are static states with CSS motion that runs only under `tx`: this script only
// sets the state classes on the round section (s1–s3, ans) as the reader scrolls, adds `tx` when one beat follows
// the previous, and drops it to jump (a skipped or reversed beat lands on its end state). Their times are TIMING.
// prefers-reduced-motion: no motion at all.
import { createStaticVNode, onBeforeUnmount, onMounted, ref } from 'vue'
import data from '../../landing/data.json'
// Written by scripts/prepare-site.mjs: the recordings in site/media (a prototype without one shows its preview).
import media from '../../.generated/landing-media.json'
import { combinedPage, datasetNotice, openPrototype, prototypes } from './prototypes.mjs'
import { CHANNEL_NAMES, DESK_ONLY, DOC_GROUPS, ONE_APP, SITUATIONS, TIMING, deskHTML, directHref, fieldSVG, galleryOf, ladderOf, momentCSS, reviewSVG, showcaseOf, stageHTML, stageModel } from './landing.mjs'

const v = field => field.value
const n = {
  n: v(data.beat1.n), folded: v(data.beat2.folded), adopted: v(data.beat2.adopted), toYou: v(data.beat2.toYou),
  toAgent: v(data.beat2.toAgent), cardsFed: v(data.beat2.cardsFed), foldedBy: v(data.beat2.foldedBy),
  account: v(data.beat2.account), blank: v(data.beat2.blank), open: v(data.beat3.open), urgent: v(data.beat3.urgent).length,
  fresh: v(data.beat3.fresh).length, lead: v(data.beat3.lead), loop: data.beat3.loop, ctx: data.beat1.context,
}
const segs = v(data.beat2.segments)
const seg = id => segs.find(s => s.id === id)
const items = segs.length
const model = stageModel(data)
// The generated markup goes in as static vnodes, not v-html: Vue 3.5 re-applies a dynamic innerHTML while
// hydrating, which rebuilt the hero's elements a beat after first paint and restarted its animations (and parsed
// the two stages twice). A static vnode adopts the server-rendered node as it is. Each one holds exactly one
// top-level element (a component is hydrated as one node), so a stage goes in as its gutter and its plot.
const Raw = props => createStaticVNode(props.html, 1)
Raw.props = ['html']
const halves = html => { const at = html.indexOf('<div class="fl-plot"'); return [html.slice(0, at), html.slice(at)] }
const beatStage = halves(stageHTML(data, 'beats'))
// The first screen: the field of everything read so far (with the screen's motion, generated from MOMENT), and the
// two windows that are drawn rather than written.
const field = `<div class="h2-field">${fieldSVG(data)}<i class="h2-cover"></i><style>${momentCSS()}</style></div>`
const desk = deskHTML(data)
const review = reviewSVG(data)
const hero = { seen: v(data.hero.seen), sources: v(data.hero.sources), days: v(data.hero.days), rounds: v(data.hero.rounds), lit: v(data.hero.lit), dark: v(data.hero.dark), itemsEver: v(data.hero.itemsEver) }
const urgentShort = v(data.beat3.urgent)[0]
const firstDue = v(data.dueAhead)[0].hours
// "8/3", "8/16 00:00": read off the replay's clock as written (Europe/Stockholm), not the reader's.
const md = t => t.slice(5, 10).split('-').map(Number).join('/')
const span = v(data.hero.span).map(t => ({ day: md(t), clock: t.slice(11, 16) }))
// The second section: every channel read so far, against one app's own count.
const sourceRows = v(data.sources.byChannel)
const widest = sourceRows[0][1]
const oneApp = sourceRows.findIndex(([name]) => name === ONE_APP)
const ladder = ladderOf(data)
const showcase = showcaseOf(prototypes).map((t, i) => ({ ...t, no: String(i + 1).padStart(2, '0'), figure: t.fig(data), href: directHref(t.prototype) }))
const gallery = galleryOf(prototypes)
// Three rows dealt round-robin, so every row mixes pages that open well on a phone with desk-only ones.
const rows = [0, 1, 2].map(r => gallery.filter((_, i) => i % 3 === r))
const recorded = new Set(media)
const clip = id => recorded.has(`${id}.mp4`) ? `/media/${id}.mp4` : null
const example = v(n.loop.example)
const channels = v(n.loop.byChannel)

// The lead question's tag line: its deadline, read off the replay clock (frames[26].at), not the reader's.
const at = new Date(v(data.frame.at)), due = new Date(n.lead.due)
const hoursLeft = Math.round((due - at) / 3600000)
const dueText = (() => {
  const [, mo, dd, hh, mi] = n.lead.due.match(/^\d{4}-(\d\d)-(\d\d)T(\d\d):(\d\d)/)
  const wd = '日一二三四五六'[new Date(Date.UTC(2026, Number(mo) - 1, Number(dd), 12)).getUTCDay()]
  return `周${wd} ${hh}:${mi} 前`
})()
const demoChoice = n.lead.actions.at(-1)

// ---------- the demo answer: the card's buttons really work, and fold it into a receipt in place ----------

const round = ref(null)
const answer = ref(null)   // { label, auto }
function choose(label, auto = false) {
  const el = round.value
  if (!auto && !reduced) el.classList.add('tx')
  answer.value = { label, auto }
  el.classList.add('ans')
}
function undo() {
  const el = round.value
  answer.value = null
  el.classList.remove('ans')
}

// ---------- the beats: which text block has crossed the reading line ----------

let reduced = false
let step = -1
let countFrame = 0
const cleanups = []

function countUp(el) {
  // Beat 1 counts the ticks as the playhead reaches them (the CSS sweep: TIMING.beats.sweep).
  const [from, span] = TIMING.beats.sweep
  const times = model.ticks.map(t => from + t.x / 100 * span).sort((a, b) => a - b)
  const start = performance.now()
  cancelAnimationFrame(countFrame)
  const tick = now => {
    const e = now - start
    let k = 0
    while (k < times.length && times[k] <= e) k += 1
    el.textContent = String(k)
    if (k < times.length) countFrame = requestAnimationFrame(tick)
  }
  el.textContent = '0'
  countFrame = requestAnimationFrame(tick)
}

function setStep(next) {
  const el = round.value
  if (!el || next === step) return
  const forward = !reduced && step >= 0 && next === step + 1
  el.classList.toggle('tx', forward)
  for (const k of [1, 2, 3]) el.classList.toggle(`s${k}`, next >= k)
  el.dataset.step = String(next)
  // The fourth block is the response loop: if the reader has not pressed a button, the demo answers for them;
  // going back above it takes a demo answer back (a reader's own answer stays).
  if (next >= 4 && !answer.value) choose(demoChoice, true)
  if (next <= 3 && answer.value?.auto) undo()
  const counter = el.querySelector('[data-count]')
  cancelAnimationFrame(countFrame)
  if (forward && next === 1) countUp(counter)
  else counter.textContent = String(model.ticks.length)
  step = next
}

function watchRound() {
  const el = round.value
  const blocks = [...el.querySelectorAll('[data-step-block]')]
  const sticky = el.querySelector('.fl-sticky')
  let frame = 0
  const update = () => {
    frame = 0
    const vh = window.innerHeight
    const wide = window.matchMedia('(min-width: 960px)').matches
    // The reading line: 55 % down on a desk (text beside the stage); on a phone, a third of the way into the
    // space left under the pinned stage.
    const bottom = wide ? 0 : Math.max(0, sticky.getBoundingClientRect().bottom)
    const line = wide ? vh * 0.55 : bottom + (vh - bottom) * 0.35
    let next = reduced ? 1 : 0
    for (const b of blocks) if (b.getBoundingClientRect().top < line) next = Math.max(next, Number(b.dataset.stepBlock))
    setStep(next)
  }
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
  // Listen to scrolling only while the section is near the viewport.
  const io = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) { window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll); onScroll() }
    else { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll) }
  }, { rootMargin: '50% 0px 50% 0px' })
  io.observe(el)
  update()
  cleanups.push(() => { io.disconnect(); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(frame) })
}

// ---------- the first screen: a tap on a situation drops the one-time motion and switches with transitions ----------

const moment = ref(null)
function pick(k) {
  const el = moment.value
  if (!el) return
  el.classList.add('manual')
  el.dataset.s = String(k)
  for (const b of el.querySelectorAll('.h2-chip')) b.setAttribute('aria-pressed', String(b.dataset.sit === String(k)))
}

// ---------- the second and third sections draw themselves once, in place, when they come into view ----------

const whyEl = ref(null)
const ladderEl = ref(null)
function drawOnce(el, threshold) {
  if (reduced) { el.classList.add('in'); return }
  const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { el.classList.add('in'); io.disconnect() } }, { threshold })
  io.observe(el)
  cleanups.push(() => io.disconnect())
}

// ---------- recordings: only the ones in view play; nothing loads before it is needed ----------

function play(video) {
  if (reduced) return
  if (!video.src) {
    // Shown over its poster only once it has a frame to show.
    video.addEventListener('playing', () => video.classList.add('on'), { once: true })
    video.src = video.dataset.src
    video.load()
  }
  const p = video.play()
  if (p) p.catch(() => {})   // autoplay refused (low power mode): the poster stays
}
function watchShowcase() {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const video = e.target.querySelector('video')
      if (!video) continue
      if (e.isIntersecting) play(video)
      else video.pause()
    }
  }, { threshold: 0.4 })
  for (const m of document.querySelectorAll('.fl-show .fl-media')) io.observe(m)
  cleanups.push(() => io.disconnect())
}

// ---------- the gallery: rows that keep moving (compositor-driven), stop for a hand or a pointer, drag sideways ----------

const SPEED = 28   // px per second
function watchGallery() {
  const section = document.querySelector('.fl-gal')
  const rowsEl = [...section.querySelectorAll('.fl-row')]
  // One copy of the row is half the track; the animation moves it by exactly that, so the loop is seamless.
  const build = (s, r, at = (r * 0.31) % 1) => {
    s.anim?.cancel()
    s.half = s.track.scrollWidth / 2
    s.duration = s.half / SPEED * 1000
    s.anim = reduced ? null : s.track.animate(
      s.left ? [{ transform: 'translateX(0)' }, { transform: `translateX(${-s.half}px)` }] : [{ transform: `translateX(${-s.half}px)` }, { transform: 'translateX(0)' }],
      { duration: s.duration, iterations: Infinity, easing: 'linear' })
    if (s.anim) { s.anim.currentTime = at * s.duration; s.anim.pause() }
  }
  const state = rowsEl.map((row, r) => {
    const s = { row, track: row.querySelector('.fl-track'), left: r % 2 === 0, anim: null, visible: false, held: 0, hover: false, drag: null, moved: false }
    build(s, r)
    return s
  })
  const running = s => s.anim && s.visible && !s.hover && !s.drag && !s.held && !document.hidden
  const sync = s => { if (!s.anim) return; if (running(s)) { if (s.anim.playState !== 'running') s.anim.play() } else if (s.anim.playState === 'running') s.anim.pause() }

  // Which tiles are in view: checked a few times a second for visible rows only (the tracks move on the compositor).
  const vw = () => window.innerWidth
  let timer = 0
  const videos = () => {
    for (const s of state) {
      for (const tile of s.track.children) {
        const video = tile.querySelector('video')
        if (!video) continue
        const b = tile.getBoundingClientRect()
        const seen = s.visible && b.right > b.width * 0.5 && b.left < vw() - b.width * 0.5
        if (seen) { if (video.paused) play(video) } else if (!video.paused) video.pause()
      }
    }
  }
  const loop = () => { videos(); timer = window.setTimeout(loop, 450) }
  const io = new IntersectionObserver(entries => {
    for (const e of entries) { const s = state.find(x => x.row === e.target); s.visible = e.isIntersecting; sync(s) }
    videos()
  }, { threshold: 0.2 })
  for (const s of state) {
    io.observe(s.row)
    const { row } = s
    row.addEventListener('mouseenter', () => { s.hover = true; sync(s) })
    row.addEventListener('mouseleave', () => { s.hover = false; sync(s) })
    row.addEventListener('pointerdown', e => {
      if (e.button !== 0) return
      s.drag = { x: e.clientX, y: e.clientY, t: s.anim ? s.anim.currentTime : 0, id: e.pointerId, captured: false }
      s.moved = false
      sync(s)
    })
    row.addEventListener('pointermove', e => {
      const d = s.drag
      if (!d || e.pointerId !== d.id) return
      const dx = e.clientX - d.x
      if (!d.captured && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(e.clientY - d.y)) { d.captured = true; s.moved = true; row.setPointerCapture(d.id) }
      if (d.captured && s.anim) {
        // Dragging right moves the track right whichever way the row runs.
        const t = d.t + (s.left ? -dx : dx) / s.half * s.duration
        s.anim.currentTime = ((t % s.duration) + s.duration) % s.duration
      }
    })
    const release = e => {
      const d = s.drag
      if (!d || e.pointerId !== d.id) return
      s.drag = null
      // A finger lifted: hold a moment before moving on, so the tile just reached can be tapped.
      if (e.pointerType !== 'mouse') { s.held += 1; window.setTimeout(() => { s.held -= 1; sync(s) }, 1600) }
      sync(s)
    }
    row.addEventListener('pointerup', release)
    row.addEventListener('pointercancel', release)
    // A drag is not a tap.
    row.addEventListener('click', e => { if (s.moved) { e.preventDefault(); e.stopPropagation(); s.moved = false } }, true)
  }
  const onVisibility = () => state.forEach(sync)
  document.addEventListener('visibilitychange', onVisibility)
  // Tiles change size at the breakpoints: rebuild the loops where they were.
  let resizeTimer = 0
  const onResize = () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => state.forEach((s, r) => {
      const at = s.anim ? (s.anim.currentTime % s.duration) / s.duration : 0
      if (Math.abs(s.track.scrollWidth / 2 - s.half) > 1) { build(s, r, at); sync(s) }
    }), 200)
  }
  window.addEventListener('resize', onResize)
  loop()
  cleanups.push(() => { io.disconnect(); window.clearTimeout(timer); window.clearTimeout(resizeTimer); window.removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', onVisibility); state.forEach(s => s.anim?.cancel()) })
}

// ---------- opening a prototype: the viewer on a desk, the page itself on a phone ----------
// The links carry target="_self" so VitePress's router leaves them alone: the prototypes are static pages outside it.

const sheet = ref(null)
function open(event, prototype) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const phone = window.matchMedia('(max-width: 959px)').matches
  if (!phone) { event.preventDefault(); openPrototype(prototype); return }
  // Laid out for a desk: say so first, and offer the link to take to a bigger screen.
  if (DESK_ONLY.has(prototype.id)) { event.preventDefault(); sheet.value = prototype }
}
const copied = ref(false)
async function share(prototype) {
  const url = new URL(directHref(prototype), location.href).href
  try {
    if (navigator.share) await navigator.share({ title: prototype.name, url })
    else { await navigator.clipboard.writeText(url); copied.value = true; window.setTimeout(() => { copied.value = false }, 1800) }
  } catch { /* dismissed */ }
}

onMounted(() => {
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document.querySelector('.fl').dataset.js = ''
  watchRound()
  drawOnce(whyEl.value, 0.3)
  drawOnce(ladderEl.value, 0.2)
  watchShowcase()
  watchGallery()
})
onBeforeUnmount(() => { cancelAnimationFrame(countFrame); cleanups.splice(0).forEach(fn => fn()) })
</script>

<template>
  <div class="fl">
    <!-- 首屏：同一刻的全部输入铺成一片点；一扇窗随处境改形，窗里重新编码，没用到的原地暗下。CSS 首绘即演一次，停在“复盘”。 -->
    <section class="fl-hero" aria-labelledby="fl-title">
      <div class="h2-text">
        <p class="fl-kick">Fold · 按处境给 Agent 的汇报编码</p>
        <h1 id="fl-title" class="fl-h">同一刻的信息，<br>按你此刻的带宽编码。</h1>
        <p class="fl-sub">Agent 能替你看着所有的软件、消息和家里的琐事，看见的没有上限；你每一刻接得住的有上限，而且随处境在变：骑车时只剩一块表盘，坐到桌前多一些，停下来复盘才全部展开。Fold 让 Agent 在每一种处境的带宽里，又快又准地，只交出你接得住、也最值得接的那部分。</p>
        <p class="fl-sub-m">Agent 看见的没有上限；<br>你接得住的有，而且随处境在变。</p>
        <p class="fl-ctas"><a class="fl-btn solid" href="#why">为什么是新问题 ↓</a><a class="fl-btn" href="#forms">直接看原型</a></p>
      </div>
      <div ref="moment" class="h2-stage" data-s="3">
        <p class="h2-cap"><span>Agent 到此刻读过 <b data-k="hero.seen">{{ hero.seen }}</b> 条</span><span><b data-k="hero.sources">{{ hero.sources }}</b> 个来源 · <b data-k="hero.days">{{ hero.days }}</b> 天</span></p>
        <Raw :html="field" />
        <p class="h2-axis" aria-hidden="true"><span>{{ span[0].day }}</span><span class="mid">一列 12 小时 · 一点一条</span><span>此刻 {{ span[1].day }} {{ span[1].clock }}</span></p>
        <div class="h2-zone">
          <i class="h2-win" aria-hidden="true" />
          <div class="h2-c h2-c1">
            <span class="n fl-num" data-k="beat3.urgent.length">{{ n.urgent }}</span><span class="u">件要紧</span>
            <span class="q">{{ urgentShort }}</span><span class="t">还有 <span data-k="dueAhead.0.hours">{{ firstDue }}</span> 小时</span>
          </div>
          <div class="h2-c h2-c2" aria-hidden="true"><Raw :html="desk" /></div>
          <div class="h2-c h2-c3" aria-hidden="true"><Raw :html="review" /><p class="ax"><span>{{ span[0].day }}</span><span>此刻</span></p></div>
        </div>
        <div class="h2-chips" role="group" aria-label="处境">
          <i class="h2-bar" aria-hidden="true" />
          <button v-for="sit in SITUATIONS" :key="sit.k" type="button" class="h2-chip" :class="`ch${sit.k}`" :data-sit="sit.k" :aria-pressed="String(sit.k === 3)" @click="pick(sit.k)"><b>{{ sit.name }}</b><span>{{ sit.time }}</span></button>
        </div>
        <p class="h2-ledger">
          <span class="lg1">交出 <b data-k="beat3.urgent.length">{{ n.urgent }}</b> 件要紧，用到其中 <b class="ver" data-k="hero.lit.urgent">{{ hero.lit.urgent }}</b> 条；其余 <span data-k="hero.dark.urgent">{{ hero.dark.urgent }}</span> 条原地暗下。</span>
          <span class="lg2">交出 <b data-k="beat2.account.items">{{ items }}</b> 件，<b class="ver" data-k="beat3.open">{{ n.open }}</b> 件等你，用到 <b data-k="hero.lit.now">{{ hero.lit.now }}</b> 条；其余 <span data-k="hero.dark.now">{{ hero.dark.now }}</span> 条原地暗下。</span>
          <span class="lg3">交出两周的走向：<b data-k="hero.rounds">{{ hero.rounds }}</b> 次整理、<b data-k="hero.itemsEver">{{ hero.itemsEver }}</b> 件事，用到 <b data-k="hero.lit.used">{{ hero.lit.used }}</b> 条；其余 <span data-k="hero.dark.used">{{ hero.dark.used }}</span> 条没落进任何一件。</span>
        </p>
      </div>
      <p class="fl-cue"><a href="#why">为什么是新问题 ↓</a></p>
    </section>

    <!-- 为什么是新问题：一个软件的通知有尽头；Agent 读的是所有渠道的总和。 -->
    <section id="why" class="fl-why" aria-labelledby="fl-why-title">
      <div class="hd">
        <p class="fl-kick">为什么是新问题</p>
        <h2 id="fl-why-title" class="fl-h">一个软件的通知有尽头，<br>Agent 看见的没有。</h2>
        <p class="fl-lede">软件是为人做的，只管自己那一摊：{{ v(data.person).split(' ')[0] }} 的幼儿园 App {{ hero.days }} 天发了 <span :data-k="`sources.byChannel.${oneApp}.1`">{{ sourceRows[oneApp][1] }}</span> 条，平铺开也看得完。Agent 不一样，它同时替他看着 GitHub、论坛、银行、幼儿园、家里的群：<span data-k="hero.sources">{{ hero.sources }}</span> 个来源，{{ hero.days }} 天 <span data-k="hero.seen">{{ hero.seen }}</span> 条，来源只会更多。看见的必然超出人接得住的；总有一刻它得替你舍掉一些，而留下的，得是你此刻接得住、也最值得接的。</p>
      </div>
      <div ref="whyEl" class="fl-src" role="img" :aria-label="`${hero.sources} 个来源各自的条数，与 Agent 读到的总数 ${hero.seen} 条`">
        <p v-for="([name, count], i) in sourceRows" :key="name" class="row" :class="{ one: i === oneApp }" :style="{ '--i': i, '--w': count / widest }">
          <span class="nm">{{ CHANNEL_NAMES[name] || name }}</span><span class="ct" :data-k="`sources.byChannel.${i}.1`">{{ count }}</span><span class="bar"><i /><em v-if="i === oneApp">← 一个软件</em></span>
        </p>
        <p class="row all" :style="{ '--i': sourceRows.length, '--w': hero.seen / widest }">
          <span class="nm">Agent</span><span class="ct" data-k="hero.seen">{{ hero.seen }}</span><span class="bar"><i /></span>
        </p>
      </div>
      <p class="fl-note">到 {{ span[1].day }} {{ span[1].clock }} 为止各渠道的条数，同一比例。最后一行是它们的总和：这一屏放不下。</p>
    </section>

    <!-- 带宽随处境变：六个原型按带宽从窄到宽，都读同一刻；点一个滚到它的卡。 -->
    <section id="bandwidth" class="fl-band" aria-labelledby="fl-band-title">
      <p class="fl-kick">带宽随处境变 · 同一刻 {{ span[1].day }} {{ span[1].clock }}</p>
      <h2 id="fl-band-title" class="fl-h">处境定了带宽，带宽定了编码。</h2>
      <p class="fl-lede">能看多久、屏幕多大、能不能当场作答，决定了交出什么、按什么顺序、用什么形式。下面六个原型读的是同一刻，按带宽从窄到宽排；它们都是表现层上的尝试，点一个看它自己讲一遍。</p>
      <ol ref="ladderEl" class="fl-ladder">
        <li v-for="(l, i) in ladder" :key="l.id" :style="{ '--gi': i, '--size': l.size }">
          <a :href="`#form-${l.id}`" :class="`g-${l.id}`">
            <span class="art"><Raw :html="l.svg" /></span>
            <span class="tx"><span class="when">{{ l.when }}</span><b>{{ l.name }}</b><span class="room">{{ l.room }}</span></span>
            <span class="fig"><span class="fl-num" :class="{ ver: l.ver }" :data-k="l.figure[2]">{{ l.figure[0] }}</span>{{ l.figure[1] }}</span>
          </a>
        </li>
      </ol>
    </section>

    <!-- 一种编码的例子：把注意力切成固定的份数；下面是一轮整理的三拍。 -->
    <header id="example" class="fl-ex" aria-labelledby="fl-ex-title">
      <p class="fl-kick">一种编码的例子</p>
      <h2 id="fl-ex-title" class="fl-h">把注意力切成固定的份数</h2>
      <p class="fl-lede">原型里试的一种编码：每一层的注意力切成固定的份数，演示里是 <span data-k="budget">{{ v(data.budget) }}</span> 份（这个数可以配）。Agent 每一轮在这些份里取舍，份数就是面积。有了面积，同一份重要性就能在手表、手机、桌面上各画各的。下面是第 {{ v(data.frame.id).slice(1) }} 轮：{{ v(data.person).split(' ')[0] }} 离开的 12 小时。</p>
    </header>

    <!-- 一轮整理：舞台钉住，文字滚过阅读线时演那一拍。 -->
    <section id="round" ref="round" class="fl-round s1 s2 s3" data-step="3" aria-labelledby="fl-round-title">
      <h2 id="fl-round-title" class="fl-sr">一轮整理</h2>
      <div class="fl-sticky">
        <div class="fl-meta">
          <span class="fl-kick k1"><b>1 涌入</b> · 8/15 12:00 → 8/16 00:00</span>
          <span class="fl-kick k2"><b>2 折</b> · Agent 整理这一轮</span>
          <span class="fl-kick k3"><b>3 开口</b> · 要你回应的</span>
          <span class="fl-kick k4"><b>3 开口</b> · 回应回流</span>
          <span class="fl-prog" aria-hidden="true"><i /><i /><i /></span>
        </div>
        <div class="fl-count" aria-live="polite">
          <span class="c c1"><span class="fl-num" data-k="beat1.n" data-count>{{ n.n }}</span><span class="lbl">条进来</span><span class="alt">两周 <span data-k="beat1.context.twoWeeks">{{ v(n.ctx.twoWeeks) }}</span> 条<br>一轮 <span data-k="beat1.context.perRound.min">{{ v(n.ctx.perRound).min }}</span>–<span data-k="beat1.context.perRound.max">{{ v(n.ctx.perRound).max }}</span> 条</span></span>
          <span class="c c2"><span class="fl-num dim" data-k="beat2.folded">{{ n.folded }}</span><span class="lbl">条折掉</span><span class="alt">暂缓 <span data-k="beat2.foldedBy.deferred">{{ n.foldedBy.deferred }}</span> · 噪音 <span data-k="beat2.foldedBy.noise">{{ n.foldedBy.noise }}</span> · 重复 <span data-k="beat2.foldedBy.duplicate">{{ n.foldedBy.duplicate }}</span><br><b data-k="beat2.adopted">{{ n.adopted }}</b> 条采用 → <span data-k="beat2.account.items">{{ items }}</span> 件</span></span>
          <span class="c c3"><span class="fl-num ver" data-k="beat3.urgent.length">{{ n.urgent }}</span><span class="lbl">件要紧</span><span class="alt"><span class="ver"><span data-k="beat3.open">{{ n.open }}</span> 件等你 · <span data-k="beat2.account.you">{{ n.account.you }}</span> 份</span><br>新问题 <span data-k="beat3.fresh.length">{{ n.fresh }}</span> 个</span></span>
          <span class="c c4"><span class="fl-num">{{ n.urgent - 1 }}</span><span class="lbl">件要紧</span><span class="alt">你答过 1 件<br>它的 <span data-k="beat3.lead.share">{{ n.lead.share }}</span> 份等下一轮读到才让出</span></span>
        </div>
        <div class="fl-stage fl-beat-stage" data-mode="beats">
          <div class="fl-stage-art" aria-hidden="true"><Raw :html="beatStage[0]" /><Raw :html="beatStage[1]" /></div>
          <div class="fl-card-zone">
            <div class="fl-card" :inert="Boolean(answer)">
              <p class="tag">要紧 · {{ dueText }} · 还有 {{ hoursLeft }} 小时 · <span data-k="beat3.lead.share">{{ n.lead.share }}</span> 份</p>
              <p class="q">{{ n.lead.prompt }}</p>
              <p class="btns"><button v-for="label in n.lead.actions" :key="label" type="button" @click="choose(label)">{{ label }}</button></p>
              <p class="foot"><span>本轮 <span data-k="beat3.lead.inputs">{{ n.lead.inputs }}</span> 条输入落进这一件</span><span class="demo">演示 · 可以按</span></p>
            </div>
            <div class="fl-receipt" :inert="!answer">
              <span class="check" aria-hidden="true">✓</span>
              <span class="t">{{ answer?.auto ? '演示替你选了' : '你选了' }}「{{ answer?.label || demoChoice }}」<small>已保存 · 等 Agent 下一轮整理，份额还没变</small></span>
              <button type="button" class="undo" @click="undo">撤回</button>
            </div>
          </div>
        </div>
      </div>

      <div class="fl-steps">
        <article class="fl-step" data-step-block="1">
          <p class="no">01 / 03 · 涌入</p>
          <h3 class="fl-h">你离开的 12 小时里，五条渠道进来 <span data-k="beat1.n">{{ n.n }}</span> 条。</h3>
          <p>一条一道刻痕，按到达时刻落在车道上。下面这把尺是这种编码里你的注意力：<b data-k="budget">64</b> 份，一轮里不会变多。</p>
        </article>
        <article class="fl-step" data-step-block="2">
          <p class="no">02 / 03 · 折</p>
          <h3 class="fl-h">折掉 <span data-k="beat2.folded">{{ n.folded }}</span> 条，剩下的挤进同一把尺。</h3>
          <p><b data-k="beat2.adopted">{{ n.adopted }}</b> 条被采用，落进各自那件事。主水管 <span data-k="beat2.segments.0.before">{{ seg('driveway-wet').before }}</span> → <b data-k="beat2.segments.0.share">{{ seg('driveway-wet').share }}</b> 份，让出来的是猫看病、Ture 和空余。</p>
        </article>
        <article class="fl-step" data-step-block="3">
          <p class="no">03 / 03 · 开口</p>
          <h3 class="fl-h"><span data-k="beat1.n">{{ n.n }}</span> 条里，真正要紧的只有 <span data-k="beat3.urgent.length">{{ n.urgent }}</span> 件。</h3>
          <p>等你的 <span data-k="beat3.open">{{ n.open }}</span> 件共 <span data-k="beat2.account.you">{{ n.account.you }}</span> 份，另外 {{ n.open - n.urgent }} 件可以晚点；Agent 那边 <span data-k="beat2.account.agentItems">{{ n.account.agentItems }}</span> 件不用你动。</p>
        </article>
        <article class="fl-step" data-step-block="4">
          <p class="no">回流 · 演示</p>
          <h3 class="fl-h">答一下，回答回到下一轮的输入里。</h3>
          <p>按钮只记下回答；那 <span data-k="beat3.lead.share">{{ n.lead.share }}</span> 份要等 Agent 下一轮整理读到，才让出来。</p>
        </article>
        <article class="fl-step fl-real">
          <p class="no">真实的一次 · {{ example.frame }}</p>
          <h3 class="fl-h">8/14 早上 08:02，一通电话。</h3>
          <p>Jonas 没点任何按钮，直接打给诊所；下一轮 Agent 读到通话记录，猫那件从 <span data-k="beat3.loop.example.share.0">{{ example.share[0] }}</span> 份让到 <span data-k="beat3.loop.example.share.1">{{ example.share[1] }}</span> 份。</p>
          <p class="fl-note">两周回应 <span data-k="beat3.loop.responses">{{ v(n.loop.responses) }}</span> 次，全在原处 · GitHub <span data-k="beat3.loop.byChannel.GitHub">{{ channels.GitHub }}</span> · iMessage <span data-k="beat3.loop.byChannel.iMessage">{{ channels.iMessage }}</span> · 问答站 <span data-k="beat3.loop.byChannel.问答">{{ channels['问答'] }}</span> · 电话 <span data-k="beat3.loop.byChannel.Telefon">{{ channels.Telefon }}</span></p>
        </article>
      </div>
    </section>

    <!-- 六种处境：录像是原型自己讲一遍，按钮打开原型本身。 -->
    <section id="forms" class="fl-show" aria-labelledby="fl-show-title">
      <p class="fl-kick">六种处境</p>
      <h2 id="fl-show-title" class="fl-h">同一份状态，六种读法</h2>
      <article v-for="(c, i) in showcase" :id="`form-${c.id}`" :key="c.id" class="fl-form" :class="[`is-${c.record}`, { flip: i % 2 }]">
        <header class="hd"><span class="no">{{ c.no }}</span><h3>{{ c.name }}</h3><span class="where">{{ c.where }}</span></header>
        <div class="fl-media">
          <img :src="recorded.has(`${c.id}.webp`) ? `/media/${c.id}.webp` : c.prototype.preview" alt="" loading="lazy" decoding="async">
          <video v-if="clip(c.id)" :data-src="clip(c.id)" muted playsinline loop preload="none" :aria-label="`${c.name}的录像：原型自己讲一遍`" />
        </div>
        <p class="cap">{{ c.record === 'phone' ? '手机 390 宽' : 'iPad 横屏' }}录像 · 原型自己讲一遍</p>
        <div class="txt">
          <p class="sit">{{ c.situation }}</p>
          <p class="form">{{ c.form }}</p>
          <p class="k">
            <span class="fig"><span class="fl-num" :class="{ ver: c.ver }" :data-k="c.figure[2]">{{ c.figure[0] }}</span>{{ c.figure[1] }}</span>
            <span class="go">
              <a class="fl-btn solid" :href="c.href" target="_self" rel="noreferrer" @click="open($event, c.prototype)">打开原型 ↗</a>
              <small v-if="c.better" class="better">{{ c.better }}</small>
            </span>
          </p>
        </div>
      </article>
    </section>

    <!-- 其余的：三行交错轮播，按住暂停、左右拖，点开。 -->
    <section id="all" class="fl-gal" aria-labelledby="fl-gal-title">
      <div class="fl-gal-hd">
        <p class="fl-kick">其余 <span data-k="gallery.count">{{ gallery.length }}</span> 种 · 一直在动</p>
        <h2 id="fl-gal-title" class="fl-h">还有 {{ gallery.length }} 种读法</h2>
        <p class="fl-lede">带“桌面”的按电脑宽度排版，手机上先看录像。按住暂停，左右拖动，点开试用。</p>
      </div>
      <div v-for="(row, r) in rows" :key="r" class="fl-row" :class="r % 2 ? 'to-right' : 'to-left'">
        <div class="fl-track">
          <template v-for="copy in 2" :key="copy">
            <a v-for="p in row" :key="`${copy}-${p.id}`" class="fl-tile" :href="directHref(p)" target="_self" rel="noreferrer" :aria-hidden="copy === 2 ? 'true' : null" :tabindex="copy === 2 ? -1 : null" :data-id="copy === 1 ? p.id : null" draggable="false" @click="open($event, p)">
              <span class="im">
                <img :src="p.preview" alt="" loading="lazy" decoding="async" draggable="false">
                <video v-if="clip(p.id)" :data-src="clip(p.id)" muted playsinline loop preload="none" />
                <span v-if="DESK_ONLY.has(p.id)" class="chip">桌面</span>
                <span v-else-if="p.withdrawn" class="chip">第一轮</span>
              </span>
              <span class="tn">{{ p.name }}</span>
              <span class="tl">{{ p.line }}</span>
            </a>
          </template>
        </div>
      </div>
      <p class="fl-gal-all"><a :href="combinedPage" target="_self">全部形式一页看（合页）↗</a></p>
    </section>

    <!-- 文档：按读者分组。 -->
    <section id="docs" class="fl-docs" aria-labelledby="fl-docs-title">
      <div class="intro">
        <p class="fl-kick">文档 · 按你是谁</p>
        <h2 id="fl-docs-title" class="fl-h">想读得更细</h2>
        <p class="fl-lede">原型之外，设计基线都在这里。精确规则以信息契约为准，范围与次序以决策记录为准。</p>
      </div>
      <div class="groups">
        <div v-for="g in DOC_GROUPS" :key="g.title" class="grp">
          <h3><b>{{ g.title }}</b>{{ g.note }}</h3>
          <a v-for="[title, href, line] in g.items" :key="href" :href="href" :target="href.endsWith('.html') ? '_self' : null"><b>{{ title }} →</b><span>{{ line }}</span></a>
        </div>
      </div>
    </section>

    <footer class="fl-foot">
      <p><b>当前阶段</b> 设计基线已完成，原型可体验；产品 CLI 与可安装 skill 尚未实现。</p>
      <p>{{ datasetNotice }}</p>
      <p class="links"><a :href="combinedPage" target="_self">合页</a><a href="https://github.com/nemori-ai/fold-skill">GitHub</a><a href="/fonts/OFL.txt" target="_self">字体许可（OFL）</a></p>
    </footer>

    <div v-if="sheet" class="fl-sheet-back" @click.self="sheet = null">
      <div class="fl-sheet" role="dialog" aria-modal="true" :aria-label="sheet.name">
        <p class="fl-kick">桌面形式</p>
        <h3>{{ sheet.name }}</h3>
        <p>这个形式按电脑宽度排版，在手机上会缩到三成左右，字读不清。先看上面的录像，或者把链接带到电脑上打开。</p>
        <p class="acts">
          <button type="button" class="fl-btn solid" @click="share(sheet)">{{ copied ? '已复制链接' : '分享 / 复制链接' }}</button>
          <a class="fl-btn" :href="directHref(sheet)" target="_self" rel="noreferrer">仍然打开</a>
          <button type="button" class="fl-btn ghost" @click="sheet = null">关闭</button>
        </p>
      </div>
    </div>
  </div>
</template>

<style>
/* ===== tokens: one paper, one ink, vermilion only for “waiting for you” (site/landing/style.md) ===== */
.fl {
  --paper: oklch(0.975 0.006 95);
  --paper-2: oklch(0.992 0.004 95);
  --ink: oklch(0.21 0.014 155);
  --ink-2: oklch(0.47 0.014 150);
  --ink-3: oklch(0.68 0.01 140);
  --rule: oklch(0.885 0.008 95);
  --fold: oklch(0.82 0.008 95);
  --agent: oklch(0.8 0.008 140);
  --ver: oklch(0.6 0.19 35);
  --ver-soft: oklch(0.86 0.06 40);
  --num: "Instrument Serif", "Times New Roman", serif;
  --cjk: "Fold Serif SC", "Songti SC", "Noto Serif CJK SC", serif;
  --sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", monospace;
  --e-fold: cubic-bezier(0.55, 0, 0.75, 0.2);
  --e-out: cubic-bezier(0.2, 0.7, 0.2, 1);
  --e-yield: cubic-bezier(0.65, 0, 0.35, 1);
  --m: 16px;
  --maxw: 1280px;
  overflow-x: clip;
  background: var(--paper);
  color: var(--ink);
  font: 15px/1.6 var(--sans);
  -webkit-font-smoothing: antialiased;
}
.fl *, .fl *::before, .fl *::after { box-sizing: border-box; }
.fl a { color: inherit; text-decoration: none; }
.fl p, .fl h1, .fl h2, .fl h3 { margin: 0; }
.fl section { scroll-margin-top: calc(var(--vp-nav-height) + 8px); }
.fl-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.fl-num { font-family: var(--num); font-weight: 400; letter-spacing: -0.02em; line-height: 0.82; font-variant-numeric: lining-nums tabular-nums; }
.fl-h { font-family: var(--cjk); font-weight: 700; letter-spacing: 0.01em; }
.fl .ver { color: var(--ver); }
.fl .dim { color: var(--ink-3); }
.fl-kick { font: 11px/1.4 var(--mono); letter-spacing: 0.06em; color: var(--ink-2); }
.fl-kick b { color: var(--ink); font-weight: 600; }
.fl-lede { color: var(--ink-2); font-size: 14.5px; line-height: 1.65; }
.fl-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 18px; border: 1.5px solid var(--ink); border-radius: 999px; background: none; color: var(--ink); font: 600 14px/1 var(--sans); cursor: pointer; white-space: nowrap; }
.fl-btn.solid { background: var(--ink); color: var(--paper); }
.fl-btn.ghost { border-color: transparent; color: var(--ink-2); }
.fl-btn:focus-visible, .fl a:focus-visible, .fl button:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
@media (hover: hover) { .fl-btn:hover { background: var(--ink); color: var(--paper); } .fl-btn.solid:hover { background: var(--ink-2); border-color: var(--ink-2); } .fl-btn.ghost:hover { background: none; color: var(--ink); } }

/* ===== the stage: lanes and ruler share one x-span; x in % / cqw of the plot, y from these variables ===== */
.fl-stage {
  --gut: 0px; --lh: 18px; --lg: 6px; --ls: calc(var(--lh) + var(--lg));
  --HL: calc(var(--ls) * 4 + var(--lh)); --ax: 18px; --rg: 10px; --R: calc(var(--HL) + var(--ax) + var(--rg)); --rh: 26px;
  --sd: 1; --tw: 1.3px; --dot: 5px;
  position: relative;
  display: grid;
  grid-template-columns: var(--gut) minmax(0, 1fr);
}
.fl-gutter { grid-column: 1; grid-row: 1; position: relative; height: calc(var(--R) + var(--rh)); }
.fl-lab { position: absolute; left: 0; top: calc(var(--l) * var(--ls) + var(--lh) / 2); transform-origin: 0 50%; display: flex; gap: 5px; align-items: baseline; translate: 0 -50%; font: 11px/1 var(--sans); color: var(--ink-2); white-space: nowrap; }
.fl-lab b { font: 10px/1 var(--mono); color: var(--ink-3); font-weight: 400; }
.fl-lab-r { position: absolute; left: 0; top: calc(var(--R) + var(--rh) / 2); translate: 0 -50%; font: 600 11px/1 var(--sans); color: var(--ink); }
.fl-plot { grid-column: 2; grid-row: 1; position: relative; container-type: inline-size; height: calc(var(--R) + var(--rh) + 10px); }
.fl-lanes { position: absolute; inset: 0 0 auto; height: var(--HL); transform-origin: 50% 100%; }
.fl-ln { position: absolute; left: 0; right: 0; top: calc(var(--l) * var(--ls) + var(--lh)); height: 1px; background: var(--rule); }
/* the ticks: one group per lane and destination, in a window that slides open behind the playhead (two
   counter-moving transforms, so the ticks themselves never move) */
.fl-sweep { position: absolute; inset: 0; overflow: hidden; }
.fl-sweep-in { position: absolute; inset: 0; }
.fl-head { position: absolute; top: 0; bottom: 0; right: 0; width: 1.5px; background: var(--ink); opacity: 0; }
.fl-lane { position: absolute; left: 0; right: 0; top: calc(var(--l) * var(--ls)); height: var(--lh); }
.fl-lane .g { position: absolute; inset: 0; transform-origin: 50% 100%; }
.fl-lane i { position: absolute; left: calc(var(--x) * 1%); top: 0; bottom: 0; width: var(--tw); background: var(--ink); }
.fl-lane .a { transform: scaleY(0.62); }
.fl-lane .f { transform: scaleY(0.17); opacity: 0.3; }
.fl-axis { position: absolute; left: 0; right: 0; top: var(--HL); height: var(--ax); font: 10px/1 var(--mono); color: var(--ink-3); }
.fl-axis span { position: absolute; left: calc(var(--x) * 1%); bottom: 2px; translate: -50% 0; }
.fl-axis span:first-child { translate: 0 0; }
.fl-axis span:last-child { translate: -100% 0; }
.fl-ruler { position: absolute; left: 0; right: 0; top: var(--R); height: var(--rh); }
.fl-bar, .fl-segs { position: absolute; inset: 0; }
.fl-bar::after { content: ""; position: absolute; inset: 0; border: 1px solid var(--ink); pointer-events: none; }
.sg { position: absolute; top: 0; bottom: 0; left: calc(var(--x) * 1%); width: calc(var(--w) * 1%); transform-origin: 0 50%; }
.sg > i { position: absolute; inset: 1px 1px; }
.sg .f { background: var(--agent); }
.sg .v { background: var(--ver-soft); }
.sg.lead .v { background: var(--ver); }
.sg .h { background: var(--ink); opacity: 0; }
.sg .done { display: grid; place-items: center; inset: 2px; border: 1px dashed var(--ink); background: var(--paper); opacity: 0; font: 10px/1 var(--mono); color: var(--ink); overflow: hidden; white-space: nowrap; }
.fl-scale { position: absolute; left: 0; right: 0; top: calc(100% + 2px); height: 7px;
  background: repeating-linear-gradient(to right, var(--ink-2) 0 1px, transparent 1px calc(100% / 8)) 0 0 / 100% 7px no-repeat,
              repeating-linear-gradient(to right, var(--ink-3) 0 1px, transparent 1px calc(100% / 64)) 0 0 / 100% 4px no-repeat; }
.fl-scale::after { content: ""; position: absolute; right: 0; top: 0; width: 1px; height: 7px; background: var(--ink-2); }
/* a dot sits where it lands (inside its segment, at mid-height) and is drawn back to its tick by --dx / --dy; at
   rest it has been absorbed, so nothing is left on the ruler */
.fl-dots { position: absolute; inset: 0; pointer-events: none; }
.dt { --y0: calc(var(--HL) - (var(--HL) - var(--l) * var(--ls) - var(--lh) / 2) * var(--sd)); --yl: calc(var(--R) + var(--rh) / 2);
  --dx: calc(var(--x0) - var(--xl)); --dy: calc(var(--y0) - var(--yl));
  position: absolute; left: calc(var(--xl) * 1% - var(--dot) / 2); top: calc(var(--yl) - var(--dot) / 2); width: var(--dot); height: var(--dot);
  border-radius: 50%; background: var(--ink); opacity: 0; }
.dt.gone { --yl: calc(var(--R) - 5px); }
/* a number that rolls with the yield: a strip of the values in between, clipped to one line */
.roll { display: inline-block; height: var(--rl, 1.4em); overflow: hidden; vertical-align: top; line-height: var(--rl, 1.4em); }
.rs { display: block; transform: translateY(calc(var(--steps) * -1 * var(--rl, 1.4em))); }

/* ===== the first screen: one field of everything read, a window that takes the situation's shape ===== */
.fl-hero { max-width: calc(var(--maxw) + 2 * var(--m)); margin: 0 auto; padding: 14px var(--m) 0; }
.fl-hero h1 { margin-top: 6px; font-size: 28px; line-height: 1.3; }
.fl-sub { display: none; margin: 14px 0 0; color: var(--ink-2); font-size: 15px; line-height: 1.7; }
.fl-sub-m { margin-top: 8px; color: var(--ink-2); font-size: 14.5px; line-height: 1.6; }
.fl-ctas { display: none; }
/* window sizes per situation (1 骑车, 2 桌前, 3 复盘); the desk window keeps the treemap's 1.7 : 1, the review window
   is 8px wider than the field on each side so its rounds stand under the field's own columns */
.h2-stage { --zh: 236px; --w1: 156px; --h1: 156px; --r1: 78px; --w2: 330px; --h2: 194px; --r2: 10px; --w3: calc(100% + 16px); --h3: var(--zh); --r3: 6px;
  position: relative; margin-top: 16px; }
.h2-cap { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; font: 11px/1.4 var(--mono); color: var(--ink-2); }
.h2-cap b { color: var(--ink); font-weight: 600; }
.h2-field { position: relative; overflow: hidden; aspect-ratio: 155 / 47; }
.h2-dots { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.h2-dots path { fill: none; stroke-width: 0.72; }
.h2-base { opacity: 0.14; }
.h2-base path, .h2-l1 path, .h2-l2 path { stroke: var(--ink); }
.h2-l3 path, .h2-l4 path { stroke: var(--ver); }
/* the two weeks are laid in left to right: a paper cover with the playhead on its edge slides off */
.h2-cover { position: absolute; inset: 0 -2px 0 0; border-left: 1.5px solid var(--ink); background: var(--paper); transform: translateX(calc(100% + 2px)); opacity: 0; }
.h2-axis { display: flex; justify-content: space-between; gap: 8px; margin-top: 4px; padding-top: 3px; border-top: 1px solid var(--rule); font: 10px/1.4 var(--mono); color: var(--ink-3); }
.h2-axis .mid { display: none; }
.h2-zone { position: relative; height: var(--zh); margin-top: 12px; }
.h2-win { position: absolute; left: 50%; top: 50%; width: var(--w3); height: var(--h3); translate: -50% -50%; border: 1.5px solid var(--ink); border-radius: var(--r3); background: var(--paper-2); }
.h2-c { position: absolute; left: 50%; top: 50%; translate: -50% -50%; opacity: 0; pointer-events: none; }
.h2-c1 { display: flex; flex-direction: column; align-items: center; justify-content: center; width: var(--w1); height: var(--h1); padding: 0 16px; text-align: center; }
.h2-c1 .n { font-size: 56px; }
.h2-c1 .u { margin-top: 4px; font: 600 12px/1.3 var(--sans); color: var(--ver); }
.h2-c1 .q { margin-top: 6px; font: 600 12px/1.35 var(--sans); }
.h2-c1 .t { margin-top: 4px; font: 10.5px/1.3 var(--mono); color: var(--ink-2); }
.h2-c2 { width: var(--w2); height: var(--h2); padding: 5px; }
.h2-desk { position: relative; width: 100%; height: 100%; }
.h2-desk .tl { position: absolute; left: calc(var(--x) * 1%); top: calc(var(--y) * 1%); width: calc(var(--w) * 1%); height: calc(var(--h) * 1%); overflow: hidden;
  padding: 4px 6px; border: 1.5px solid var(--paper-2); border-radius: 5px; background: var(--agent); }
.h2-desk .tl.you { background: var(--ver-soft); }
.h2-desk .tl.lead { background: var(--ver); color: var(--paper-2); }
.h2-desk .tl.blank { border: 1px dashed var(--ink-3); background: none; }
.h2-desk .tl b { display: block; font: 600 11px/1.25 var(--sans); white-space: nowrap; }
.h2-c3 { width: var(--w3); height: var(--h3); padding: 12px 8px 0; }
.h2-stack { display: block; width: 100%; height: calc(100% - 20px); }
.h2-stack .col { transform-box: fill-box; transform-origin: 50% 100%; }
.h2-c3 .ax { display: flex; justify-content: space-between; height: 20px; font: 10px/20px var(--mono); color: var(--ink-3); }
.h2-chips { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 12px; border-top: 1px solid var(--rule); }
.h2-bar { position: absolute; left: 0; top: -1px; width: calc(100% / 3); height: 2px; background: var(--ink); transform: translateX(200%); }
.h2-chip { min-height: 48px; padding: 8px 6px 4px 0; border: 0; background: none; color: var(--ink-3); text-align: left; font: inherit; cursor: pointer; }
.h2-chip b { display: block; font: 600 14.5px/1.3 var(--sans); }
.h2-chip span { display: block; font: 11px/1.4 var(--mono); }
.h2-ledger { position: relative; min-height: 64px; margin-top: 6px; font-size: 13px; line-height: 1.6; color: var(--ink-2); }
.h2-ledger > span { position: absolute; left: 0; right: 0; top: 0; opacity: 0; }
.h2-ledger b { color: var(--ink); font-weight: 600; }
.h2-ledger b.ver { color: var(--ver); }
/* the static states (the last one, 复盘, is where the motion stops; reduced motion starts there) */
.h2-stage .ch3 { color: var(--ink); }
.h2-stage .h2-c3, .h2-stage .lg3 { opacity: 1; }
.h2-stage[data-s="1"] .h2-win { width: var(--w1); height: var(--h1); border-radius: var(--r1); }
.h2-stage[data-s="2"] .h2-win { width: var(--w2); height: var(--h2); border-radius: var(--r2); }
.h2-stage[data-s="1"] .h2-c3, .h2-stage[data-s="2"] .h2-c3, .h2-stage[data-s="1"] .lg3, .h2-stage[data-s="2"] .lg3 { opacity: 0; }
.h2-stage[data-s="1"] .ch3, .h2-stage[data-s="2"] .ch3 { color: var(--ink-3); }
.h2-stage[data-s="1"] .h2-c1, .h2-stage[data-s="1"] .lg1, .h2-stage[data-s="2"] .h2-c2, .h2-stage[data-s="2"] .lg2 { opacity: 1; }
.h2-stage[data-s="1"] .ch1, .h2-stage[data-s="2"] .ch2 { color: var(--ink); }
.h2-stage[data-s="1"] .h2-bar { transform: translateX(0); }
.h2-stage[data-s="2"] .h2-bar { transform: translateX(100%); }
.h2-stage[data-s="1"] .h2-l1, .h2-stage[data-s="1"] .h2-l2, .h2-stage[data-s="1"] .h2-l3, .h2-stage[data-s="2"] .h2-l1 { opacity: 0; }
/* a tap: the window changes shape, the old content goes first, the new one comes once the window has its shape */
.h2-stage.manual .h2-win { transition: width 650ms var(--e-yield), height 650ms var(--e-yield), border-radius 650ms var(--e-yield); }
.h2-stage.manual .h2-c, .h2-stage.manual .h2-ledger > span { transition: opacity 140ms ease-in; }
.h2-stage.manual[data-s="1"] .h2-c1, .h2-stage.manual[data-s="2"] .h2-c2, .h2-stage.manual[data-s="3"] .h2-c3,
.h2-stage.manual[data-s="1"] .lg1, .h2-stage.manual[data-s="2"] .lg2, .h2-stage.manual[data-s="3"] .lg3 { transition: opacity 260ms ease-out 380ms; }
.h2-stage.manual .h2-dots { transition: opacity 300ms ease-out 150ms; }
.h2-stage.manual .h2-bar { transition: transform 400ms var(--e-yield); }
.h2-stage.manual .h2-chip { transition: color 200ms; }
@keyframes h2-sweep { from { transform: translateX(0); opacity: 1; } 96% { opacity: 1; } to { transform: translateX(calc(100% + 2px)); opacity: 0; } }
@keyframes h2-dim { from { opacity: 1; } }
@keyframes h2-in { from { opacity: 0; } }
@keyframes h2-open { from { opacity: 0; transform: scale(0.86); width: var(--w1); height: var(--h1); border-radius: var(--r1); } to { opacity: 1; transform: none; width: var(--w1); height: var(--h1); border-radius: var(--r1); } }
@keyframes h2-12 { from { width: var(--w1); height: var(--h1); border-radius: var(--r1); } to { width: var(--w2); height: var(--h2); border-radius: var(--r2); } }
@keyframes h2-23 { from { width: var(--w2); height: var(--h2); border-radius: var(--r2); } to { width: var(--w3); height: var(--h3); border-radius: var(--r3); } }
@keyframes h2-rise { from { transform: scaleY(0); } }
.fl-cue { margin-top: 8px; padding: 12px 0; border-top: 1px solid var(--rule); font: 12px/1.5 var(--mono); }

/* ===== why it is new, the situations' ladder, the example's heading ===== */
.fl-why, .fl-band, .fl-ex { max-width: calc(var(--maxw) + 2 * var(--m)); margin: 0 auto; padding: 64px var(--m) 0; }
.fl-why h2, .fl-band h2, .fl-ex h2 { margin: 8px 0 8px; font-size: 24px; line-height: 1.34; }
/* the figure runs to the screen's right edge, so the last row (the sum, same scale) visibly runs off it */
.fl-src { margin: 20px calc(-1 * var(--m)) 0 0; overflow: hidden; }
.fl-src .row { display: grid; grid-template-columns: 72px 38px minmax(0, 1fr); align-items: center; gap: 0 8px; height: 13px; font: 10.5px/13px var(--mono); color: var(--ink-3); white-space: nowrap; }
.fl-src .nm { overflow: hidden; text-overflow: ellipsis; }
.fl-src .ct { text-align: right; }
.fl-src .bar { position: relative; display: flex; align-items: center; gap: 6px; height: 100%; container-type: inline-size; }
.fl-src .bar i { flex: none; width: max(1px, calc(var(--w) * (100cqw - var(--m)))); height: 5px; background: var(--ink-3); transform-origin: 0 50%; }
.fl-src .bar em { font-style: normal; color: var(--ink); }
.fl-src .row.one { color: var(--ink); font-weight: 600; }
.fl-src .row.one .bar i { background: var(--ink); }
.fl-src .row.all { height: 24px; margin-top: 10px; color: var(--ink); font: 600 12px/24px var(--mono); }
.fl-src .row.all .bar i { height: 12px; background: var(--ink); }
.fl[data-js] .fl-src:not(.in) .bar i { transform: scaleX(0); }
.fl[data-js] .fl-src:not(.in) .bar em { opacity: 0; }
.fl-src.in .bar i { transition: transform 420ms var(--e-out) calc(var(--i) * 28ms); }
.fl-src.in .bar em { transition: opacity 240ms ease-out 900ms; }
.fl-src.in .row.all .bar i { transition: transform 1100ms var(--e-yield) 900ms; }
.fl-why .fl-note { margin-top: 10px; font: 11.5px/1.6 var(--mono); color: var(--ink-3); }

.fl-ladder { margin: 18px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--rule); }
.fl-ladder a { display: grid; grid-template-columns: 112px minmax(0, 1fr); grid-template-rows: auto auto; align-items: center; gap: 4px 14px; padding: 12px 0; border-bottom: 1px solid var(--rule); }
.fl-ladder .art { grid-row: 1 / 3; display: grid; place-items: center; }
.fl-ladder .art svg { display: block; width: calc(var(--size) * 1px); height: auto; overflow: visible; }
.fl-ladder .tx { display: flex; flex-direction: column; font-size: 14.5px; line-height: 1.4; }
.fl-ladder .when { font: 11px/1.4 var(--mono); color: var(--ink-2); }
.fl-ladder .tx b { font-weight: 600; }
.fl-ladder .room { font-size: 12.5px; color: var(--ink-2); }
.fl-ladder .fig { font: 12px/1.3 var(--mono); color: var(--ink-2); }
.fl-ladder .fig .fl-num { margin-right: 5px; font-size: 30px; color: var(--ink); vertical-align: -3px; }
.fl-ladder .fig .fl-num.ver { color: var(--ver); }
.fl-ladder svg text { font: 9px var(--mono); fill: var(--ink-2); }
.fl-ladder svg .g-num { font: 44px var(--num); fill: var(--ink); }
.fl-ladder svg .g-frame { fill: none; stroke: var(--ink); stroke-width: 1.2; }
.fl-ladder svg .g-tick { stroke-width: 2.4; stroke-linecap: round; }
@media (hover: hover) { .fl-ladder a:hover .tx b { text-decoration: underline; text-underline-offset: 3px; } }
.fl[data-js] .fl-ladder:not(.in) li { opacity: 0; transform: translateY(6px); }
.fl-ladder.in li { transition: opacity 260ms ease-out calc(var(--gi) * 150ms), transform 360ms var(--e-out) calc(var(--gi) * 150ms); }
.fl[data-js] .fl-ladder:not(.in) .g-a { opacity: 0; }
.fl-ladder .g-rise { transform-box: fill-box; transform-origin: 50% 100%; }
.fl-ladder .g-band { transform-box: fill-box; transform-origin: 0 50%; }
.fl[data-js] .fl-ladder:not(.in) .g-rise { transform: scaleY(0.2); }
.fl[data-js] .fl-ladder:not(.in) .g-band { transform: scaleX(0); }
.fl-ladder.in .g-a { transition: opacity 260ms ease-out calc(var(--gi) * 150ms + 120ms + var(--i) * 90ms), transform 420ms var(--e-out) calc(var(--gi) * 150ms + 120ms + var(--i) * 90ms); }
.fl-ladder.in .g-tick, .fl-ladder.in .g-cell { transition: opacity 160ms ease-out calc(var(--gi) * 150ms + 120ms + var(--i) * 7ms); }
.fl-ex .fl-lede { max-width: 40em; }

/* the motion, shared by the first screen and the beats */
@keyframes fl-open { from { transform: translateX(-100%); } }
@keyframes fl-hold { from { transform: translateX(100%); } }
@keyframes fl-head { from, 94% { opacity: 1; } to { opacity: 0; } }
@keyframes fl-agent { from { transform: none; } }
@keyframes fl-fold { from { transform: none; opacity: 1; } }
@keyframes fl-in { from { opacity: 0; } }
@keyframes fl-yield { from { transform: translateX(calc((var(--bx) - var(--x)) * 1cqw)) scaleX(calc(var(--bw) / var(--w))); } }
@keyframes fl-flash { 0% { opacity: 0; } 14%, 76% { opacity: 0.16; } 100% { opacity: 0; } }
/* a dot: an arc from its tick (sideways easing out, down easing in, sampled from landing.mjs's curves), then it
   shrinks into its segment */
@keyframes fl-drop {
  0% { opacity: 0; transform: translate(calc(var(--dx) * 1cqw), var(--dy)) scale(1); }
  7.4% { opacity: 1; transform: translate(calc(var(--dx) * 0.839cqw), calc(var(--dy) * 0.995)) scale(1); }
  14.8% { transform: translate(calc(var(--dx) * 0.664cqw), calc(var(--dy) * 0.977)) scale(1); }
  22.2% { transform: translate(calc(var(--dx) * 0.491cqw), calc(var(--dy) * 0.945)) scale(1); }
  29.6% { transform: translate(calc(var(--dx) * 0.34cqw), calc(var(--dy) * 0.895)) scale(1); }
  37% { transform: translate(calc(var(--dx) * 0.219cqw), calc(var(--dy) * 0.822)) scale(1); }
  44.4% { transform: translate(calc(var(--dx) * 0.13cqw), calc(var(--dy) * 0.721)) scale(1); }
  51.8% { transform: translate(calc(var(--dx) * 0.067cqw), calc(var(--dy) * 0.587)) scale(1); }
  59.2% { transform: translate(calc(var(--dx) * 0.028cqw), calc(var(--dy) * 0.418)) scale(1); }
  66.6% { transform: translate(calc(var(--dx) * 0.006cqw), calc(var(--dy) * 0.217)) scale(1); }
  74% { opacity: 1; transform: translate(0, 0) scale(1); }
  82% { opacity: 1; transform: translate(0, 0) scale(1.25, 0.7); }
  100% { opacity: 0; transform: translate(0, 0) scale(0); }
}

/* ===== one round: the pinned stage and the three beats ===== */
.fl-round { position: relative; max-width: calc(var(--maxw) + 2 * var(--m)); margin: 28px auto 0; padding: 0 var(--m); }
.fl-sticky { position: sticky; top: 0; z-index: 2; padding: 12px 0 10px; background: var(--paper); border-bottom: 1px solid var(--rule); }
.fl-meta { position: relative; display: flex; align-items: center; height: 18px; }
.fl-meta .fl-kick { position: absolute; left: 0; top: 2px; opacity: 0; transition: opacity 140ms ease-in; white-space: nowrap; }
.fl-prog { display: flex; gap: 5px; margin-left: auto; width: 72px; }
.fl-prog i { flex: 1; height: 2px; background: var(--rule); transition: background-color 200ms; }
.fl-round.s1 .fl-prog i:nth-child(1), .fl-round.s2 .fl-prog i:nth-child(2), .fl-round.s3 .fl-prog i:nth-child(3) { background: var(--ink); }
/* text that changes in place goes out first and then comes in (140ms each), so no two are ever on top of each other */
.fl-round:not(.s1) .k1, .fl-round.s1:not(.s2) .k1, .fl-round.s2:not(.s3) .k2, .fl-round.s3:not(.ans) .k3, .fl-round.s3.ans .k4 { opacity: 1; transition: opacity 140ms ease-out 140ms; }
.fl-count { position: relative; height: 70px; margin: 8px 0 6px; }
.fl-count .c { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 8px; opacity: 0; transition: opacity 140ms ease-in, translate 140ms ease-in; translate: 0 6px; }
.fl-count .fl-num { font-size: 72px; }
.fl-count .lbl { padding-bottom: 6px; font-size: 15px; font-weight: 600; white-space: nowrap; }
.fl-count .alt { margin-left: auto; padding-bottom: 4px; text-align: right; font: 11.5px/1.5 var(--mono); color: var(--ink-2); }
.fl-count .alt b { color: var(--ink); }
.fl-round:not(.s2) .c1, .fl-round.s2:not(.s3) .c2, .fl-round.s3:not(.ans) .c3, .fl-round.s3.ans .c4 { opacity: 1; translate: 0 0; transition: opacity 140ms ease-out 140ms, translate 180ms var(--e-out) 140ms; }

/* The beat stage keeps one height. In beats 1 and 2 the lanes fill the room the card will need (HL is sized so the
   ruler sits at the bottom); in beat 3 they compress to --s3 and everything moves up by what they gave, and the
   card opens under the ruler. Beat 2 compresses them to --s2 first, towards the ruler. */
.fl-beat-stage { --gut: 42px; --cardH: 192px; --s2: 0.6; --s3: 0.2; --sd: var(--s2); --zw: 100%;
  --HL: calc((var(--cardH) - 8px) / (1 - var(--s3))); --ls: calc(var(--HL) / 4.75); --lh: calc(var(--ls) * 0.75);
  display: block; height: calc(var(--HL) * var(--s3) + var(--ax) + var(--rg) + var(--rh) + 26px + var(--cardH)); }
.fl-stage-art { display: grid; grid-template-columns: var(--gut) minmax(0, 1fr); }
.fl-beat-stage .fl-plot { height: calc(var(--R) + var(--rh) + 28px); }
.fl-deltas, .fl-prev { --rl: 14px; position: absolute; left: 0; right: 0; top: calc(var(--R) + var(--rh) + 11px); height: 30px; font: 10px/14px var(--mono); color: var(--ink-2); white-space: nowrap; }
.fl-prev { opacity: 0; }
.fl-deltas > div { display: flex; flex-wrap: wrap; gap: 0 12px; height: 15px; overflow: hidden; }
.fl-deltas .up { color: var(--ink); }
.fl-deltas .down { color: var(--ink-3); }
.fl-lab-d { position: absolute; left: 0; top: calc(var(--R) + var(--rh) + 11px); font: 10px/14px var(--sans); color: var(--ink); opacity: 0; }
.fl-lab-d.down { top: calc(var(--R) + var(--rh) + 26px); color: var(--ink-3); }
.fl-deltas { opacity: 0; }

/* the card zone sits under the ruler, inside the plot's span; a brace under the urgent segment, a stem down to the card */
.fl-card-zone { position: absolute; left: var(--gut); width: min(var(--zmax, 100vw), calc(100% - var(--gut))); top: calc(var(--R) + var(--rh) + 26px); }
.fl-lead { position: absolute; opacity: 0; }
.fl-lead.brace { left: calc(var(--lx) * 1% + 1px); width: calc(var(--lw) * 1% - 2px); top: calc(var(--R) + var(--rh) + 9px); height: 6px; border: 1.5px solid var(--ver); border-top: 0; }
.fl-lead.stem { left: calc((var(--lx) + var(--lw) / 2) * 1%); width: 1.5px; top: calc(var(--R) + var(--rh) + 15px); height: 12px; background: var(--ver); }
.fl-card { position: relative; padding: 11px 13px 12px; border: 1.5px solid var(--ver); border-radius: 14px; background: var(--paper-2); transform-origin: 50% 0; opacity: 0; visibility: hidden; transform: scaleY(0.04); }
.fl-card .tag { font: 11px/1.4 var(--mono); color: var(--ver); }
.fl-card .demo { flex: none; color: var(--ink-3); }
.fl-card .q { margin: 6px 0 10px; font: 600 15.5px/1.45 var(--sans); }
.fl-card .btns { display: flex; gap: 8px; }
.fl-card .btns button { flex: 1; min-height: 44px; border: 1.5px solid var(--ver); border-radius: 10px; background: none; color: var(--ver); font: 600 14px/1.2 var(--sans); cursor: pointer; transition: transform 120ms; }
.fl-card .btns button:active { transform: scale(0.97); }
@media (hover: hover) { .fl-card .btns button:hover { background: var(--ver); color: var(--paper-2); } }
.fl-card .foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; font: 11px/1.4 var(--mono); color: var(--ink-2); }
.fl-card > * { opacity: 1; }
.fl-receipt { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 6px 4px 6px 12px; border: 1.5px solid var(--rule); border-radius: 14px; background: var(--paper-2); opacity: 0; visibility: hidden; translate: 0 4px; }
.fl-receipt .check { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--ink); font-size: 12px; }
.fl-receipt .t { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 650; line-height: 1.35; }
.fl-receipt small { display: block; margin-top: 1px; font-size: 11.5px; font-weight: 400; color: var(--ink-3); }
.fl-receipt .undo { flex: none; min-width: 44px; min-height: 44px; border: 0; border-radius: 10px; background: none; color: var(--ink-2); font: 600 13px/1 var(--sans); cursor: pointer; }
/* the answer goes back in as an input of the next round: from the receipt up the right edge, into the first lane
   after 00:00 (y of the first lane's middle once the lanes are compressed: --y1; the receipt's middle: --yb) */
.fl-ret { --y1: calc(var(--HL) - (var(--HL) - var(--lh) / 2) * var(--s3)); --yb: calc(var(--R) + var(--rh) + 26px + 28px);
  position: absolute; background: var(--ver); opacity: 0; visibility: hidden; }
/* (hidden, not only transparent: it reaches 10px past the plot, and Chrome left a stale strip of the previous page
   there after a client-side navigation into the landing while it was only opacity 0) */
.fl-ret.b { left: var(--zw); right: -10px; top: var(--yb); height: 1.5px; }
.fl-ret.v { right: -10px; width: 1.5px; top: var(--y1); height: calc(var(--yb) - var(--y1) + 1.5px); }
.fl-ret.t { right: -10px; width: 14px; top: var(--y1); height: 1.5px; }
.fl-ret.t::before { content: ""; position: absolute; left: -2px; top: -3.25px; border-style: solid; border-width: 4px 6px 4px 0; border-color: transparent var(--ver) transparent transparent; }

/* ---- static states ---- */
.fl-round:not(.s1) .fl-beat-stage .fl-sweep { transform: translateX(-100%); }
.fl-round:not(.s1) .fl-beat-stage .fl-sweep-in { transform: translateX(100%); }
.fl-round:not(.s2) .fl-beat-stage .fl-lane .g { transform: none; opacity: 1; }
.fl-round:not(.s2) .fl-beat-stage .sg { transform: translateX(calc((var(--bx) - var(--x)) * 1cqw)) scaleX(calc(var(--bw) / var(--w))); }
.fl-round:not(.s3) .fl-beat-stage .sg .v { opacity: 0; }
.fl-round.s1:not(.s2) .fl-prev { opacity: 1; }
.fl-round.s2 .fl-lanes { transform: scaleY(var(--s2)); }
.fl-round.s2 .fl-lab { translate: 0 calc(-50% + (var(--HL) - var(--l) * var(--ls) - var(--lh) / 2) * (1 - var(--s2))); }
.fl-round.s2:not(.s3) .fl-deltas, .fl-round.s2:not(.s3) .fl-lab-d { opacity: 1; }
.fl-round.s3 .fl-lanes { transform: scaleY(var(--s3)); opacity: 0.28; }
.fl-round.s3 .fl-lab { translate: 0 calc(-50% + (var(--HL) - var(--l) * var(--ls) - var(--lh) / 2) * (1 - var(--s3))); opacity: 0; }
.fl-round.s3 .fl-beat-stage .fl-stage-art, .fl-round.s3 .fl-card-zone { transform: translateY(calc(var(--HL) * (var(--s3) - 1))); }
.fl-round.s3 .fl-lead { opacity: 1; }
.fl-round.s3:not(.ans) .fl-card { opacity: 1; visibility: visible; transform: none; }
.fl-round.s3.ans .fl-receipt { opacity: 1; visibility: visible; translate: 0 0; }
.fl-round.s3.ans .sg.lead .v { opacity: 0; }
.fl-round.s3.ans .sg.lead .done { opacity: 1; }
.fl-round.s3.ans .fl-ret { opacity: 1; visibility: visible; }
.fl-round.s3.ans .fl-lead.stem { background: var(--ink-3); }
.fl-round.s3.ans .fl-lead.brace { border-color: var(--ink-3); }

/* ---- motion: only while one beat follows the previous (.tx); a jump has none and lands on the static state ---- */
/* beat 1: the playhead runs the 12 hours */
.fl-round.tx.s1:not(.s2) .fl-beat-stage .fl-sweep { animation: fl-open 1600ms linear 150ms both; }
.fl-round.tx.s1:not(.s2) .fl-beat-stage .fl-sweep-in { animation: fl-hold 1600ms linear 150ms both; }
.fl-round.tx.s1:not(.s2) .fl-beat-stage .fl-head { animation: fl-head 1600ms linear 150ms both; }
/* (the note under the ruler comes first: the grey allocation is last round's, before anything lands in it) */
.fl-round.tx.s1:not(.s2) .fl-prev { transition: opacity 200ms ease-out 150ms; }
/* beat 2: fold, squeeze towards the ruler, the 40 fall and are absorbed while the ruler re-divides (TIMING.beats) */
.fl-round.tx.s2:not(.s3) .fl-prev { transition: opacity 140ms ease-in; }
.fl-round.tx.s2:not(.s3) .fl-beat-stage .fl-lane .a { animation: fl-agent 240ms var(--e-fold) both; }
.fl-round.tx.s2:not(.s3) .fl-beat-stage .fl-lane .f { animation: fl-fold 240ms var(--e-fold) both; }
.fl-round.tx.s2:not(.s3) .fl-lanes, .fl-round.tx.s2:not(.s3) .fl-lab { transition: transform 600ms var(--e-yield) 260ms, translate 600ms var(--e-yield) 260ms; }
.fl-round.tx.s2:not(.s3) .fl-beat-stage .dt { animation: fl-drop var(--dd) linear var(--d) both; }
.fl-round.tx.s2:not(.s3) .fl-beat-stage .sg { animation: fl-yield var(--yd) var(--e-yield) var(--yt) both; }
.fl-round.tx.s2:not(.s3) .fl-beat-stage .sg .h { animation: fl-flash var(--fd) linear var(--fa) both; }
.fl-round.tx.s2:not(.s3) .fl-deltas, .fl-round.tx.s2:not(.s3) .fl-lab-d { transition: opacity 160ms ease-out calc(var(--yt) - 80ms); }
.fl-round.tx.s2:not(.s3) .fl-deltas .rs { animation: var(--roll) var(--yd) linear var(--yt) both; }
/* beat 3: the lanes give their room to the card */
.fl-round.tx.s3 .fl-lanes { transition: transform 450ms var(--e-yield) 200ms, opacity 300ms; }
.fl-round.tx.s3 .fl-lab { transition: translate 450ms var(--e-yield) 200ms, opacity 160ms; }
.fl-round.tx.s3 .fl-stage-art, .fl-round.tx.s3 .fl-card-zone { transition: transform 450ms var(--e-yield) 200ms; }
.fl-round.tx.s3 .sg .v { transition: opacity 300ms ease-out 450ms; }
.fl-round.tx.s3 .sg.lead .v { transition: opacity 300ms ease-out 850ms; }
.fl-round.tx.s3 .fl-lead { transition: opacity 200ms ease-out 1000ms; }
.fl-round.tx.s3:not(.ans) .fl-card { transition: transform 450ms var(--e-out) 1150ms, opacity 150ms 1150ms, visibility 0s 1150ms; }
.fl-round.tx.s3:not(.ans) .fl-card > * { transition: opacity 150ms 1550ms; }
.fl-round.tx.s3:not(.ans) .fl-receipt { transition: opacity 150ms, visibility 0s 150ms; }
/* answering: the card folds into its receipt in place (折), the urgent segment empties, the line runs back up */
.fl-round.tx.s3.ans .fl-card { transition: transform 240ms var(--e-fold), opacity 200ms var(--e-fold) 60ms, visibility 0s 260ms; transform: scaleY(0.3); }
.fl-round.tx.s3.ans .fl-receipt { transition: opacity 200ms ease-out 270ms, translate 200ms ease-out 270ms, visibility 0s 270ms; }
.fl-round.tx.s3.ans .sg.lead .v { transition: opacity 240ms 240ms; }
.fl-round.tx.s3.ans .sg.lead .done { transition: opacity 240ms 300ms; }
.fl-round.tx.s3.ans .fl-ret { transition: opacity 300ms ease-out 450ms, visibility 0s 450ms; }
.fl-round.tx:not(.s3) .fl-card { transition: none; }
.fl-round.s3.ans .fl-card { transform: scaleY(0.3); }

/* the text blocks */
.fl-steps { position: relative; z-index: 1; }
.fl-step { min-height: 62svh; padding: 26px 0 0; }
.fl-step .no { font: 11px/1.4 var(--mono); letter-spacing: 0.08em; color: var(--ink-2); }
.fl-step h3 { margin: 8px 0 8px; font-size: 22px; line-height: 1.36; }
.fl-step p:not(.no) { color: var(--ink-2); font-size: 14.5px; line-height: 1.65; }
.fl-step b { color: var(--ink); font-weight: 600; }
.fl-real { min-height: 0; padding: 30px 0 64px; border-top: 1px solid var(--rule); margin-top: 0; }
.fl-real h3 { font-size: 19px; }
.fl-note { margin-top: 8px; font: 11.5px/1.6 var(--mono) !important; color: var(--ink-3) !important; }

.fl-show, .fl-docs { max-width: calc(var(--maxw) + 2 * var(--m)); margin: 0 auto; padding: 56px var(--m) 0; }
.fl-show > h2 { margin: 8px 0 8px; font-size: 25px; line-height: 1.3; }

/* ===== the six situations ===== */
.fl-form { margin-top: 26px; padding-top: 12px; border-top: 1px solid var(--ink); }
.fl-form .hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.fl-form .hd .no { font: 13px var(--mono); color: var(--ink-2); }
.fl-form .hd h3 { font: 700 22px/1.2 var(--cjk); }
.fl-form .hd .where { margin-left: auto; font: 11px/1.3 var(--mono); color: var(--ink-2); text-align: right; }
.fl-media { position: relative; display: grid; place-items: center; overflow: hidden; border: 1px solid var(--rule); border-radius: 18px; background: var(--paper-2); }
.fl-media img, .fl-media video { grid-area: 1 / 1; display: block; width: 100%; height: auto; }
.fl-media video { opacity: 0; transition: opacity 300ms; }
.fl-media video.on { opacity: 1; }
.fl-form.is-phone .fl-media { aspect-ratio: auto; padding: 14px 0; }
.fl-form.is-phone .fl-media img, .fl-form.is-phone .fl-media video { width: auto; max-width: 78%; max-height: min(62svh, 560px); border-radius: 12px; box-shadow: 0 0 0 1px var(--rule); }
.fl-form.is-pad .fl-media img, .fl-form.is-pad .fl-media video { aspect-ratio: 1180 / 820; object-fit: cover; }
.fl-form .cap { margin-top: 6px; font: 11px/1.4 var(--mono); color: var(--ink-3); }
.fl-form .sit { margin: 14px 0 4px; font: 600 15px/1.5 var(--sans); }
.fl-form .form { color: var(--ink-2); font-size: 14.5px; line-height: 1.65; }
.fl-form .k { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; margin-top: 14px; }
.fl-form .fig { font: 13px var(--mono); }
.fl-form .fig .fl-num { margin-right: 6px; font-size: 38px; vertical-align: -4px; }
.fl-form .go { display: flex; align-items: center; gap: 10px; }
.fl-form .better { font: 11px/1.4 var(--mono); color: var(--ink-3); max-width: 9em; }

/* ===== the gallery ===== */
.fl-gal { padding: 64px 0 0; }
.fl-gal-hd { max-width: calc(var(--maxw) + 2 * var(--m)); margin: 0 auto 18px; padding: 0 var(--m); }
.fl-gal-hd h2 { margin: 8px 0 6px; font-size: 24px; line-height: 1.3; }
.fl-row { overflow: hidden; margin-bottom: 14px; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
.fl-track { display: flex; gap: 12px; width: max-content; padding-left: 12px; }
.fl-tile { flex: none; width: 176px; -webkit-touch-callout: none; }
.fl-tile .im { position: relative; display: grid; overflow: hidden; aspect-ratio: 16 / 10; border: 1px solid var(--rule); border-radius: 10px; background: var(--paper-2); }
.fl-tile .im img, .fl-tile .im video { grid-area: 1 / 1; display: block; width: 100%; height: 100%; object-fit: cover; object-position: top center; }
.fl-tile .im video { opacity: 0; transition: opacity 300ms; }
.fl-tile .im video.on { opacity: 1; }
.fl-tile .chip { position: absolute; right: 6px; top: 6px; padding: 1px 7px; border: 1px solid var(--rule); border-radius: 99px; background: var(--paper); font: 10px/1.5 var(--mono); color: var(--ink-2); }
.fl-tile .tn { display: block; margin-top: 7px; font-size: 13px; font-weight: 600; line-height: 1.35; }
.fl-tile .tl { display: -webkit-box; overflow: hidden; font-size: 11.5px; line-height: 1.45; color: var(--ink-2); -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
@media (hover: hover) { .fl-tile:hover .tn { text-decoration: underline; text-underline-offset: 3px; } .fl-tile:hover .im { border-color: var(--ink-3); } }
.fl-gal-all { max-width: calc(var(--maxw) + 2 * var(--m)); margin: 6px auto 0; padding: 0 var(--m); font: 12px/1.5 var(--mono); }
.fl-gal-all a { text-decoration: underline; text-underline-offset: 4px; text-decoration-color: var(--rule); }

/* ===== documents and footer ===== */
.fl-docs h2 { margin: 8px 0 8px; font-size: 24px; line-height: 1.3; }
.fl-docs .groups { display: grid; gap: 22px; margin-top: 20px; }
.fl-docs .grp h3 { margin: 0 0 4px; padding-bottom: 8px; border-bottom: 1px solid var(--ink); font: 11px/1.4 var(--mono); letter-spacing: 0.06em; color: var(--ink-2); }
.fl-docs .grp h3 b { display: block; margin-bottom: 2px; font: 600 15px/1.4 var(--sans); letter-spacing: 0; color: var(--ink); }
.fl-docs .grp a { display: block; padding: 9px 0; border-bottom: 1px solid var(--rule); }
.fl-docs .grp a b { font-size: 14.5px; font-weight: 600; }
.fl-docs .grp a span { display: block; font-size: 12.5px; line-height: 1.5; color: var(--ink-2); }
@media (hover: hover) { .fl-docs .grp a:hover b { text-decoration: underline; text-underline-offset: 3px; } }
.fl-foot { max-width: calc(var(--maxw) + 2 * var(--m)); margin: 56px auto 0; padding: 18px var(--m) 40px; border-top: 1px solid var(--rule); font-size: 12.5px; line-height: 1.7; color: var(--ink-2); }
.fl-foot b { color: var(--ink); margin-right: 6px; }
.fl-foot p + p { margin-top: 6px; }
.fl-foot .links { display: flex; gap: 18px; font-family: var(--mono); font-size: 12px; }
.fl-foot .links a { text-decoration: underline; text-underline-offset: 4px; text-decoration-color: var(--rule); }

/* the phone sheet for desk-only forms */
.fl-sheet-back { position: fixed; inset: 0; z-index: 90; display: flex; align-items: flex-end; background: oklch(0.21 0.014 155 / 0.28); }
.fl-sheet { width: 100%; padding: 18px var(--m) calc(22px + env(safe-area-inset-bottom)); border-radius: 18px 18px 0 0; background: var(--paper); }
.fl-sheet h3 { margin: 6px 0 6px; font: 700 20px/1.3 var(--sans); }
.fl-sheet p:not(.fl-kick):not(.acts) { color: var(--ink-2); font-size: 14px; line-height: 1.65; }
.fl-sheet .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }

/* ===== iPad portrait and up ===== */
@media (min-width: 700px) {
  .fl { --m: 32px; }
  .fl-hero { padding-top: 32px; }
  .fl-hero h1 { font-size: 40px; line-height: 1.26; }
  .fl-sub { display: block; font-size: 16px; max-width: 40em; }
  .fl-sub-m { display: none; }
  .h2-stage { --zh: 300px; --w1: 200px; --h1: 200px; --r1: 100px; --h2: 286px; --w2: calc(286px * 1.7); margin-top: 26px; }
  .h2-cap { font-size: 12px; }
  .h2-axis { font-size: 11px; }
  .h2-axis .mid { display: inline; }
  .h2-c1 .n { font-size: 74px; }
  .h2-c1 .u { font-size: 13.5px; }
  .h2-c1 .q { font-size: 14px; }
  .h2-c1 .t { font-size: 11.5px; }
  .h2-desk .tl b { font-size: 12.5px; }
  .h2-chip b { font-size: 16px; }
  .h2-chip span { font-size: 12px; }
  .h2-ledger { min-height: 48px; font-size: 14.5px; }
  .fl-why h2, .fl-band h2, .fl-ex h2 { font-size: 32px; }
  .fl-why .fl-lede, .fl-band .fl-lede { font-size: 15.5px; max-width: 40em; }
  .fl-src .row { grid-template-columns: 96px 44px minmax(0, 1fr); height: 15px; font-size: 11.5px; line-height: 15px; }
  .fl-ladder a { grid-template-columns: 160px minmax(0, 1fr); padding: 16px 0; }
  .fl-ladder .art svg { width: calc(var(--size) * 1.3px); }
  .fl-beat-stage { --gut: 60px; --rh: 32px; --cardH: 180px; }
  .fl-deltas > div { position: relative; display: block; }
  .dl { position: absolute; left: calc(var(--x) * 1%); top: 0; translate: -50% 0; }
  .dl.blank { translate: -100% 0; }
  .fl-count .fl-num { font-size: 88px; }
  .fl-count { height: 84px; }
  .fl-step h3 { font-size: 26px; }
  .fl-step p:not(.no) { font-size: 15.5px; max-width: 36em; }
  .fl-beat-stage { --zw: min(100%, 560px); --zmax: 560px; }
  .fl-show > h2 { font-size: 32px; }
  .fl-tile { width: 260px; }
  .fl-docs .groups { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px 32px; }
}

/* ===== desk: 8 columns of the 64 grid ===== */
@media (min-width: 960px) {
  .fl { --m: 48px; }
  .fl-hero { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); column-gap: 32px; align-items: start; padding-top: 36px; }
  .h2-text { grid-column: 1 / 4; padding-top: 26px; }
  .h2-stage { grid-column: 4 / 9; margin-top: 0; --zh: clamp(250px, 35vh, 340px); --h1: calc(var(--zh) * 0.66); --w1: var(--h1); --r1: calc(var(--h1) / 2);
    --h2: calc(var(--zh) - 14px); --w2: calc((var(--zh) - 14px) * 1.7); }
  .fl-hero h1 { font-size: clamp(34px, 3.1vw, 46px); line-height: 1.26; }
  .fl-sub { font-size: 16px; line-height: 1.75; }
  .fl-ctas { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
  .fl-cue { display: none; }
  .h2-ledger { min-height: 30px; font-size: 14px; }

  .fl-why { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); column-gap: 32px; padding-top: 112px; }
  .fl-why .hd { grid-column: 1 / 4; }
  .fl-why .fl-src { grid-column: 4 / 9; margin-top: 6px; }
  .fl-why .fl-note { grid-column: 4 / 9; }
  .fl-why h2, .fl-band h2, .fl-ex h2 { font-size: 34px; }
  .fl-band { padding-top: 112px; }
  .fl-ladder { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); column-gap: 24px; margin-top: 28px; border-top: 1px solid var(--ink); }
  .fl-ladder a { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; height: 100%; padding: 16px 0 18px; border-bottom: 0; }
  .fl-ladder .art { height: 176px; place-items: end start; margin-bottom: 8px; }
  .fl-ladder .art svg { width: calc(var(--size) * 1.5px); }
  .fl-ex { padding-top: 112px; }

  .fl-round { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); column-gap: 32px; margin-top: 48px; }
  .fl-steps { grid-column: 1 / 4; grid-row: 1; }
  .fl-sticky { grid-column: 4 / 9; grid-row: 1; align-self: start; top: calc(var(--vp-nav-height) + max(12px, (100vh - var(--vp-nav-height) - 560px) / 2)); border-bottom: 0; }
  .fl-step { display: flex; flex-direction: column; justify-content: center; min-height: 72vh; padding: 0; opacity: 0.32; transition: opacity 300ms; }
  .fl-step:first-child { min-height: 60vh; justify-content: flex-start; padding-top: 4vh; }
  .fl-round[data-step="1"] [data-step-block="1"], .fl-round[data-step="2"] [data-step-block="2"], .fl-round[data-step="3"] [data-step-block="3"], .fl-round[data-step="4"] [data-step-block="4"], .fl-round[data-step="4"] .fl-real { opacity: 1; }
  .fl-real { min-height: 50vh; border-top: 0; opacity: 1 !important; }
  .fl-step h3 { font-size: 28px; }
  .fl-count .fl-num { font-size: 112px; }
  .fl-count { height: 104px; }
  .fl-count .alt { font-size: 12.5px; }
  .fl-beat-stage { --gut: 72px; --ax: 22px; --rg: 14px; --rh: 38px; --cardH: 196px; }
  .fl-show > h2 { margin-bottom: 8px; }
  .fl-form { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); column-gap: 32px; row-gap: 0; margin-top: 44px; }
  .fl-form .hd { grid-column: 1 / 9; }
  .fl-form .fl-media { grid-column: 1 / 6; grid-row: 2; }
  .fl-form .cap { grid-column: 1 / 6; grid-row: 3; }
  .fl-form .txt { grid-column: 6 / 9; grid-row: 2; align-self: center; }
  .fl-form.flip .fl-media, .fl-form.flip .cap { grid-column: 4 / 9; }
  .fl-form.flip .txt { grid-column: 1 / 4; }
  .fl-form .sit { margin-top: 0; font-size: 17px; }
  .fl-form .form { font-size: 15px; }
  .fl-form.is-phone .fl-media img, .fl-form.is-phone .fl-media video { max-height: 600px; }
  .fl-gal { padding-top: 96px; }
  .fl-gal-hd h2 { font-size: 32px; }
  .fl-tile { width: 300px; }
  .fl-docs { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); column-gap: 32px; padding-top: 96px; }
  .fl-docs .intro { grid-column: 1 / 3; }
  .fl-docs .groups { grid-column: 3 / 9; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 0; }
  .fl-docs h2 { font-size: 32px; }
  .fl-foot { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 32px; }
  .fl-foot .links { grid-column: 1 / 3; margin-top: 10px; }
}
@media (min-width: 1440px) { .fl { --m: 80px; } }

@media (prefers-reduced-motion: reduce) {
  .fl *, .fl *::before, .fl *::after { transition: none !important; animation: none !important; }
}
</style>
