// The prototypes the site offers, in the order of prototype/all.html, and the shared state of the
// gallery panel, the viewer and the demo data the site's examples play. The nav menu (PrototypeMenu), the home page
// and the overlays (PrototypeLayer) all read these.
import { reactive } from 'vue'
import { forms, withdrawn, sketches, motions } from '../../../prototype/forms/catalog.mjs'
import { defaultDataset } from '../../../prototype/data/select.mjs'

// Short lines and default frames follow prototype/README.md「十二种形式」and all.html; names and the withdrawn forms'
// questions come from catalog.mjs so they stay in step with the prototype itself.
// `embed` holds what all.html adds when it embeds a page: the desks hide their version switchers
// (the gallery is the switcher here) and the forms fold their concept card, which the page can reopen.
const desk = (id, name, line) => ({ id, name, line, page: '/prototype/', query: id === 'original' ? {} : { variant: id }, embed: { embed: 1 } })
const form = id => forms.find(f => f.id === id)
const sketch = id => sketches.find(f => f.id === id)
const motion = id => motions.find(f => f.id === id)

// The demo data the site can play (2026-11-04: a reader switches the landing's examples between them; landing/spec.md
// 「切换演示数据」). founder (陆晨的两周, written by the author) is the prototypes' default; composite (Jonas 的两周,
// pseudonymised rewrites of real public data) is the older one. Each has the frames a prototype opens at in the viewer:
// founder's follow all.html (f22, the night before the customer meeting; the glasses f21, when the customer's question
// became the top one), composite's are the ones the site used before founder (0374070: f26, C f25). `media` is where its
// previews and recordings sit under /previews and /media (scripts/record-landing.mjs, docs/development.md).
export const DEMOS = {
  founder: { frames: { original: 22, a: 22, b: 22, c: 22, d: 22, duo: 22, watch: 22, multiples: 22, trays: 22, glasses: 21 }, media: '' },
  composite: { frames: { original: 26, a: 26, b: 26, c: 25, d: 26, duo: 26, watch: 26, multiples: 26, trays: 26, glasses: 26 }, media: 'composite/' },
}
export const DEFAULT_DEMO = defaultDataset

const entries = [
  desk('original', '原版树图', '在电脑前掌握两周局面，顺手处理工作评审'),
  desk('a', 'A 空间排布', '桌前，生活急事要当场二选一'),
  desk('b', 'B 时间展开', '期限落在此刻之后的哪里，谁先到'),
  desk('c', 'C 流动形态', '可以推后的事沉下去，到点浮起'),
  desk('d', 'D 手机首页', '离开半天回来，先答最急的 3 件'),
  desk('duo', 'E 折叠屏', '翻开折叠屏：左页摊开这一轮的输入，每组一条线穿过折痕连进右页那张卡'),
  { id: 'watch', name: form('watch').name, line: '抬腕两秒：要不要现在掏手机', page: '/prototype/forms/watch.html', embed: { card: 0 } },
  { id: 'multiples', name: form('multiples').name, line: '复盘两周注意力怎样移动', page: '/prototype/forms/multiples.html', embed: { card: 0 } },
  ...[
    ['lineage', '追一件事的来龙去脉：改名、撤下、并入'],
    ['timing', '我欠了谁什么回应，开了多久'],
    ['provenance', '某件事背后是谁在推动'],
    ['yield', '一件事变大，份额从谁那里来'],
    ['notation', '每一轮整理读了多少、丢了多少、动了几件'],
    ['morph', '收到多少不等于给多少：Agent 放大了谁、压小了谁'],
    ['peak', '离开期间升起又落下、回来时已经看不出来的事'],
    ['age', '此刻的份额多少是沉淀的、多少是刚换手的'],
    ['chain', '谁在等你、你挡住了谁：答掉一件，放走一串人'],
    ['tug', '家里与工作在 64 份里此消彼长，你实际在哪一边动手'],
  ].map(([id, line]) => ({ id, name: sketch(id).name, line, page: `/prototype/forms/sketches/${id}.html` })),
  // 结绳 opens on its default sample, the hand-written story (catalog.mjs `sample`): it has two levels of sub-layers;
  // founder has one (白鹭上线, f04–f06, reachable from the page's own dataset link) and composite none.
  { id: 'khipu', name: sketch('khipu').name, line: '一件事里还有自己的 64 份，最深一件折合根层才几份', page: '/prototype/forms/sketches/khipu.html', query: { data: 'story' } },
  { id: 'trays', name: form('trays').name, line: '答完这些要点几下：托盘几排就是几下，按掉一下矮一排', page: '/prototype/forms/trays.html', embed: { card: 0 } },
  // Round-three concept animations open without a frame, so the viewer plays their loop.
  { id: 'pulse', name: motion('pulse').name, line: '一轮整理演成一次脉冲：上百条进来，要你开口的只有一两件', page: '/prototype/forms/motion/pulse.html', embed: { card: 0 } },
  { id: 'dial', name: motion('dial').name, line: '64 份是怎样的硬约束：一轮整理演成 20 秒动画', page: '/prototype/forms/motion/dial.html', embed: { card: 0 } },
  { id: 'respond', name: '回应组件', line: '六种回应控件逐类演示，附反馈记录', page: '/prototype/forms/respond.html' },
  ...withdrawn.map(f => ({ id: f.id, name: f.name, line: f.question, page: `/prototype/forms/${f.id}.html`, embed: { card: 0 }, withdrawn: true })),
  { id: 'glasses', name: form('glasses').name, line: '眼镜上只给一件：最前那件换了才亮，通话时亮对方在等的那件', page: '/prototype/forms/glasses.html', embed: { card: 0 } },
]

function address(entry, embedded, frame) {
  const query = new URLSearchParams({ ...entry.query, ...(embedded ? entry.embed : {}) })
  if (frame != null) query.set('frame', frame)
  return `${entry.page}${String(query) ? `?${query}` : ''}`
}

// One list per demo: the addresses carry ?data= (none for the default; a page with its own data, 结绳's hand-written
// story, keeps it) and that demo's frame, and the previews and recordings are that demo's (结绳 shares the default's).
function listOf(name) {
  return entries.map((entry, index) => {
    const own = Boolean(entry.query?.data)
    const e = own || name === DEFAULT_DEMO ? entry : { ...entry, query: { ...entry.query, data: name } }
    const frame = DEMOS[name].frames[entry.id]
    const media = own ? DEMOS[DEFAULT_DEMO].media : DEMOS[name].media
    return {
      id: entry.id,
      no: String(index + 1).padStart(2, '0'),
      name: entry.name,
      line: entry.line,
      withdrawn: Boolean(entry.withdrawn),
      // `src` is what the viewer loads; `href` is the page on its own, for a new tab or without script.
      src: address(e, true, frame),
      href: address(e, false, frame),
      media,
      preview: `/previews/${media}${entry.id}.webp`,
    }
  })
}
const lists = Object.fromEntries(Object.keys(DEMOS).map(name => [name, listOf(name)]))
/** The prototypes as one demo plays them. */
export const prototypesOf = name => lists[name] ?? lists[DEFAULT_DEMO]
/** The default demo's list (the scripts' and the server-rendered page's). */
export const prototypes = lists[DEFAULT_DEMO]

/** The page with every form, playing that demo (all.html reads ?data= as the prototypes do). */
export const combinedOf = name => `/prototype/all.html${name === DEFAULT_DEMO ? '' : `?data=${name}`}`
export const combinedPage = combinedOf(DEFAULT_DEMO)

// ---------- which demo the site plays ----------
// One choice for the whole site: the landing's examples, its live six and gallery, the nav's panel and the viewer.
// It starts as the default (so the server-rendered page and hydration agree) and is restored once the page is up:
// from the address (?data=, the landing writes it there) or else from what this browser chose last (localStorage, a
// convenience only: it may be missing or throw, and the page must not care).
export const demo = reactive({ data: DEFAULT_DEMO })
const STORE = 'fold-demo-data'
let restored = false
export function restoreDemo() {
  if (restored || typeof window === 'undefined') return
  restored = true
  const asked = new URLSearchParams(window.location.search).get('data')
  let kept = null
  try { kept = window.localStorage.getItem(STORE) } catch {}
  demo.data = [asked, kept].find(name => Object.hasOwn(DEMOS, name ?? '')) ?? DEFAULT_DEMO
}
export function chooseDemo(name) {
  if (!Object.hasOwn(DEMOS, name)) return
  demo.data = name
  try { window.localStorage.setItem(STORE, name) } catch {}
}

// One panel and one viewer per page; the nav button exists twice (bar and mobile screen menu).
export const gallery = reactive({ open: false, current: null, trigger: null })

export function toggleGallery(trigger) {
  gallery.trigger = trigger || null
  gallery.open = !gallery.open
}

export function openPrototype(prototype) {
  gallery.current = prototype
}

export function closePrototype() {
  gallery.current = null
}
