// The prototypes the site offers, in the order of prototype/all.html, and the shared state of the
// gallery panel and the viewer. The nav menu (PrototypeMenu), the home page and the overlays
// (PrototypeLayer) all read this one list.
import { reactive } from 'vue'
import { forms, withdrawn, sketches, motions } from '../../../prototype/forms/catalog.mjs'
import { datasets, defaultDataset } from '../../../prototype/data/select.mjs'

// Short lines and default frames follow prototype/README.md「十二种形式」and all.html; names and the
// withdrawn forms' questions come from catalog.mjs so they stay in step with the prototype itself.
// `embed` holds what all.html adds when it embeds a page: the desks hide their version switchers
// (the gallery is the switcher here) and the forms fold their concept card, which the page can reopen.
const desk = (id, name, line, frame) => ({ id, name, line, page: '/prototype/', query: id === 'original' ? {} : { variant: id }, embed: { embed: 1 }, frame })
const form = id => forms.find(f => f.id === id)
const sketch = id => sketches.find(f => f.id === id)
const motion = id => motions.find(f => f.id === id)

const entries = [
  desk('original', '原版树图', '在电脑前掌握两周局面，顺手处理工作评审', 26),
  desk('a', 'A 空间排布', '桌前，生活急事要当场二选一', 26),
  desk('b', 'B 时间展开', '期限落在此刻之后的哪里，谁先到', 26),
  desk('c', 'C 流动形态', '可以推后的事沉下去，到点浮起', 25),
  desk('d', 'D 手机首页', '离开半天回来，先答最急的 3 件', 26),
  { id: 'watch', name: form('watch').name, line: '抬腕两秒：要不要现在掏手机', page: '/prototype/forms/watch.html', embed: { card: 0 }, frame: 26 },
  { id: 'multiples', name: form('multiples').name, line: '复盘两周注意力怎样移动', page: '/prototype/forms/multiples.html', embed: { card: 0 }, frame: 26 },
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
  // 结绳 opens on its default sample, the hand-written story (composite has no layers in two weeks).
  { id: 'khipu', name: sketch('khipu').name, line: '一件事里还有自己的 64 份，最深一件折合根层才几份', page: '/prototype/forms/sketches/khipu.html', query: { data: 'story' } },
  // Round-three concept animations open without a frame, so the viewer plays their loop.
  { id: 'pulse', name: motion('pulse').name, line: '一轮整理演成一次脉冲：上百条进来，要你开口的只有一两件', page: '/prototype/forms/motion/pulse.html', embed: { card: 0 } },
  { id: 'dial', name: motion('dial').name, line: '64 份是怎样的硬约束：一轮整理演成 20 秒动画', page: '/prototype/forms/motion/dial.html', embed: { card: 0 } },
  { id: 'respond', name: '回应组件', line: '六种回应控件逐类演示，附反馈记录', page: '/prototype/forms/respond.html' },
  ...withdrawn.map(f => ({ id: f.id, name: f.name, line: f.question, page: `/prototype/forms/${f.id}.html`, embed: { card: 0 }, withdrawn: true })),
]

function address(entry, embedded) {
  const query = new URLSearchParams({ ...entry.query, ...(embedded ? entry.embed : {}) })
  if (entry.frame != null) query.set('frame', entry.frame)
  return `${entry.page}${String(query) ? `?${query}` : ''}`
}

export const prototypes = entries.map((entry, index) => ({
  id: entry.id,
  no: String(index + 1).padStart(2, '0'),
  name: entry.name,
  line: entry.line,
  withdrawn: Boolean(entry.withdrawn),
  // `src` is what the viewer loads; `href` is the page on its own, for a new tab or without script.
  src: address(entry, true),
  href: address(entry, false),
  preview: `/previews/${entry.id}.webp`,
}))

export const combinedPage = '/prototype/all.html'
export const datasetLabel = datasets[defaultDataset].label
export const datasetNotice = datasets[defaultDataset].notice

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
