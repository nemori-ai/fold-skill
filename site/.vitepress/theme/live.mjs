// The fifth section of the landing page (#forms, FoldLanding.vue): six prototypes played live as pictures, on one
// clock. Rationale, budgets and measurements: site/landing/spec.md「第四轮」.
//
// Every block (`[data-live]`) holds a still of the clock's frame (an <img>); a live page goes on top of it only while
// it shows that same frame. The pages are the prototypes themselves at ?embed=show (prototype/embed.mjs): no controls,
// no input (the frame is inert and takes no pointer), laid out at their own size (data-w × data-h) and scaled into the
// block. They follow frames with the all.html protocol: the clock posts {fold: 'go', frame}, a page answers
// {fold: 'at', frame}, and posts {fold: 'shown'} once it has drawn its first view.
//
// One clock: it moves on only when its time on a frame is up and every page it drives has reported that frame (a
// page still loading gets a grace period; the next stills of the blocks on screen are decoded first), so at any moment
// the blocks show the same round. A page that falls behind (paused off screen, or loaded while the clock moved) is
// covered by its still, sent to the clock's frame, and shown again once its own transition has played.
//
// What it costs: no frame exists before the section is near the viewport. Only blocks on or near the screen get a
// page, at most cap() at once (2 on a phone), loaded one after another; a page that leaves the screen stops following
// (paused) and is unloaded once it is far away or a block on screen needs its place. The clock stops while the section
// is away, the tab is hidden, or the prototype viewer is open. Reduced motion: no pages and no clock; the markup's
// <source> shows the stills of the last frame before any script runs.

/**
 * @param {HTMLElement} section
 * @param {{ frames: number[], dwell: number, hold: number, settle: number, phoneStill: string[],
 *   srcOf: (id: string, frame: number) => string, stillOf: (id: string, frame: number) => string, label: (frame: number) => string }} options
 * @returns {{ stop(): void, hold(on: boolean): void }}
 */
export function playLive(section, { frames, dwell, hold, settle, phoneStill, srcOf, stillOf, label }) {
  const last = frames.length - 1
  const ticks = [...section.querySelectorAll('[data-live-ticks]')]
  const labels = [...section.querySelectorAll('[data-live-at]')]
  const blocks = [...section.querySelectorAll('[data-live]')].map(el => ({
    id: el.dataset.live, el, img: el.querySelector('img'), w: Number(el.dataset.w), h: Number(el.dataset.h), title: el.dataset.title || '',
    iframe: null, at: null, atSince: 0, shown: false, synced: false, fresh: false, wanted: false, wantedAt: 0, seen: 0, gap: Infinity, failed: false, timers: [],
  }))
  let k = 0
  const paint = () => {
    for (const t of ticks) [...t.children].forEach((tick, i) => tick.classList.toggle('on', i <= k))
    for (const l of labels) l.textContent = label(frames[k])
    section.dataset.frame = String(frames[k])
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !blocks.length) {
    k = last
    paint()
    return { stop() {}, hold() {} }
  }

  const phone = () => innerWidth < 700
  const cap = () => (phone() ? 2 : innerWidth < 1200 ? 4 : 6)
  const stillOnly = b => phone() && phoneStill.includes(b.id)
  const later = (b, fn, ms) => { const t = setTimeout(() => { b.timers = b.timers.filter(x => x !== t); fn() }, ms); b.timers.push(t) }

  // ---------- stills ----------
  // Only the blocks on screen or about to be (a third of a screen away) follow the clock with their stills; the rest
  // catch up when they come that near, so a phone does not fetch a still a round for blocks it is not showing.
  const decoded = new Map()
  function prefetch(url) {
    if (!decoded.has(url)) {
      const im = new Image()
      im.src = url
      const done = im.decode().then(() => true, () => true)
      done.then(() => { done.done = true })
      decoded.set(url, done)
    }
    return decoded.get(url)
  }
  const ready = url => decoded.has(url) && decoded.get(url).done
  function setStill(b, frame) {
    const url = stillOf(b.id, frame)
    if (b.img.getAttribute('src') !== url) b.img.src = url
  }
  const stillNear = b => b.gap < innerHeight * 0.35

  // ---------- the page at its own size, scaled to the block ----------
  const scale = b => { if (b?.iframe) b.iframe.style.transform = `scale(${(b.el.clientWidth / b.w).toFixed(4)})` }
  const resized = new ResizeObserver(entries => { for (const e of entries) scale(blocks.find(b => b.el === e.target)) })
  blocks.forEach(b => resized.observe(b.el))

  // ---------- pages ----------
  let loading = null
  const post = (b, frame) => b.iframe?.contentWindow?.postMessage({ fold: 'go', frame }, location.origin)
  function load(b) {
    const iframe = document.createElement('iframe')
    Object.assign(iframe, { title: b.title, tabIndex: -1, inert: true, className: 'lv-live' })
    iframe.setAttribute('aria-hidden', 'true')
    iframe.setAttribute('scrolling', 'no')
    iframe.style.width = `${b.w}px`
    iframe.style.height = `${b.h}px`
    iframe.src = srcOf(b.id, frames[k])
    Object.assign(b, { iframe, at: null, shown: false, synced: false, fresh: true })
    scale(b)
    b.img.closest('picture').after(iframe)
    loading = b
    // A page that never says it has drawn (an error) gives its place back and stays a still.
    later(b, () => { if (b.iframe === iframe && !b.shown) { b.failed = true; unload(b); pump() } }, 20000)
  }
  function unload(b) {
    if (!b.iframe) return
    b.timers.forEach(clearTimeout)
    b.timers = []
    setStill(b, frames[k])
    b.iframe.remove()
    Object.assign(b, { iframe: null, at: null, shown: false, synced: false, retiring: false })
    if (loading === b) loading = null
  }
  // A page on screen gives its place to another: it goes once its still of the clock's frame is ready to take over.
  function retire(b) {
    if (b.retiring) return
    b.retiring = true
    const iframe = b.iframe
    Promise.race([prefetch(stillOf(b.id, frames[k])), new Promise(done => setTimeout(done, 1500))])
      .then(() => { if (b.iframe === iframe && b.retiring && !b.wanted) { unload(b); pump() } else b.retiring = false })
  }
  // Show a page that has drawn once it is on the clock's frame. One that is not is sent there first and shown when its
  // own transition has had time to play; one loaded straight at the frame is shown at once.
  function sync(b) {
    if (!b.iframe || !b.shown || b.synced || !b.wanted) return
    const frame = frames[k]
    if (b.at !== frame) { b.fresh = false; post(b, frame); return }
    const show = () => { if (b.iframe && b.wanted && b.at === frames[k]) { b.synced = true; b.iframe.classList.add('on') } }
    const wait = b.fresh ? 0 : settle - (performance.now() - b.atSince)
    if (wait <= 0) show()
    else later(b, show, wait)
  }
  function onMessage(event) {
    if (event.origin !== location.origin) return
    const b = blocks.find(x => x.iframe && x.iframe.contentWindow === event.source)
    if (!b) return
    const { fold, frame } = event.data || {}
    if (fold === 'at' && Number.isInteger(frame) && frame !== b.at) { b.at = frame; b.atSince = performance.now(); sync(b) }
    if (fold === 'shown' && !b.shown) {
      b.shown = true
      if (loading === b) loading = null
      sync(b)
      pump()
    }
  }
  addEventListener('message', onMessage)

  // ---------- which blocks get a page ----------
  function plan() {
    const vh = innerHeight, now = performance.now()
    for (const b of blocks) {
      const r = b.el.getBoundingClientRect()
      b.seen = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)) / Math.max(1, r.height)
      b.gap = r.bottom < 0 ? -r.bottom : r.top > vh ? r.top - vh : 0
    }
    const near = active() ? blocks.filter(b => !stillOnly(b) && !b.failed && b.gap < vh * 0.35).sort((x, y) => y.seen - x.seen || x.gap - y.gap).slice(0, cap()) : []
    for (const b of blocks) {
      const wanted = near.includes(b)
      if (wanted && !b.wanted) b.wantedAt = now
      b.wanted = wanted
      sync(b)
      if (!b.synced && stillNear(b)) setStill(b, frames[k])
    }
    // Far away: unload. Played as a still on this screen, or its place needed by a block on screen: retire. The
    // farthest first; a paused page that is in nobody's way stays.
    const alive = blocks.filter(b => b.iframe && !b.retiring).sort((x, y) => y.gap - x.gap)
    const waiting = blocks.filter(b => b.wanted && !b.iframe).length
    let count = alive.length
    for (const b of alive) {
      if (b.wanted) continue
      if (b.gap > vh) { unload(b); count -= 1 } else if (count + waiting > cap() || stillOnly(b)) { retire(b); count -= 1 }
    }
    pump()
  }
  // One page loads at a time, for a block that has stayed wanted a moment (not one scrolled straight past).
  let pumpTimer = 0
  function pump() {
    clearTimeout(pumpTimer)
    if (loading || !active()) return
    const next = blocks.filter(b => b.wanted && !b.iframe).sort((x, y) => y.seen - x.seen)[0]
    if (!next || blocks.filter(b => b.iframe).length >= cap()) return
    const wait = next.wantedAt + 220 - performance.now()
    if (wait > 0) pumpTimer = setTimeout(plan, wait)
    else load(next)
  }

  // ---------- the clock ----------
  let near = false, held = false, running = false, started = 0, elapsed = 0, clock = 0, fetched = -1
  const active = () => near && !held && !document.hidden
  const dwellOf = i => (i === last ? hold : dwell)
  const AHEAD = 1600   // the next stills are fetched this long before the frame is due
  function resume() {
    if (running || !active()) return
    running = true
    started = performance.now() - elapsed
    plan()
    tick()
  }
  function pause() {
    if (running) { running = false; elapsed = performance.now() - started; clearTimeout(clock) }
    plan()
  }
  function tick() {
    clearTimeout(clock)
    if (!running) return
    const now = performance.now(), due = started + dwellOf(k), next = (k + 1) % frames.length
    // The blocks on screen that show their still (no page, or a page not on the frame): their next still, ahead.
    const stills = blocks.filter(b => b.seen > 0 && !b.synced)
    if (now >= due - AHEAD && fetched !== next) { fetched = next; stills.forEach(b => prefetch(stillOf(b.id, frames[next]))) }
    if (now < due) { clock = setTimeout(tick, (now < due - AHEAD ? due - AHEAD : due) - now); return }
    const late = now - due
    const behind = blocks.some(b => b.wanted && b.synced && b.at !== frames[k])
    const coming = blocks.some(b => b.wanted && b.iframe && !b.shown)
    const undecoded = stills.some(b => !ready(stillOf(b.id, frames[next])))
    if ((behind && late < 4000) || ((coming || undecoded) && late < 3000)) { clock = setTimeout(tick, 120); return }
    k = next
    started = now
    for (const b of blocks) {
      if (b.iframe && b.wanted && b.shown) post(b, frames[k])
      // a page paused off screen falls behind here: covered by its still until it is driven again and catches up
      else if (b.synced) { b.synced = false; b.iframe.classList.remove('on') }
      if (!b.synced && stillNear(b)) setStill(b, frames[k])
    }
    paint()
    clock = setTimeout(tick, Math.max(0, dwellOf(k) - AHEAD))
  }

  // ---------- watching ----------
  let raf = 0
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; plan() }) }
  const onVisibility = () => (document.hidden ? pause() : resume())
  const io = new IntersectionObserver(([entry]) => {
    near = entry.isIntersecting
    if (near) { addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll); resume() }
    else { removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll); pause() }
  }, { rootMargin: '40% 0px 40% 0px' })
  // Far away (a screen beyond the near margin): every page goes.
  const far = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) blocks.forEach(unload) }, { rootMargin: '140% 0px 140% 0px' })
  io.observe(section)
  far.observe(section)
  document.addEventListener('visibilitychange', onVisibility)
  paint()

  return {
    stop() {
      io.disconnect(); far.disconnect(); resized.disconnect()
      removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll); removeEventListener('message', onMessage)
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(clock); clearTimeout(pumpTimer); cancelAnimationFrame(raf)
      blocks.forEach(unload)
    },
    // The prototype viewer (or the gallery panel) is open over the page: the clock stops and the pages wait, paused.
    hold(on) { held = on; if (on) pause(); else resume() },
  }
}
