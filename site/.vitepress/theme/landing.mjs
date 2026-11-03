// The landing page (FoldLanding.vue): which prototypes it shows and in what order, what each card says, and the
// geometry of the first screen, the situations' glyphs and the beat stage, all computed from site/landing/data.json (the f26 replay).
// No imports: the page, config.mts and the scripts (record-landing, check-landing) read the same tables.
// Rationale and audit: site/landing/spec.md; story and timings: site/landing/story.md; look: site/landing/style.md.

const v = field => field.value

// ---------- which prototypes, in what order ----------

// The six showcase forms, in the order the user signed off (2026-11-02): from one minute on a phone, to a few
// minutes with one thumb, to two seconds on a wrist, to unfolding the device, to a weekend review, to the timeline.
// `record` is the size its clip is recorded at (scripts/record-landing.mjs): a phone for the phone-native forms,
// an iPad on its side for the ones that need the room.
export const TOP = [
  {
    id: 'd', name: '手机首页', where: '手机 · 1 分钟', record: 'phone',
    situation: '离开半天回来，掏出手机看一分钟。',
    form: '一屏只放得下三张卡、拇指只够一排按钮，所以首页只排等你回应的事：最急的在最上面、字最大，一按就答，答完原地收成回执。',
    fig: d => [v(d.beat3.open), '件等你回应', 'beat3.open'], ver: true,
  },
  {
    id: 'trays', name: '回应托盘', where: '手机 · 几分钟', record: 'phone',
    situation: '排队、通勤的几分钟，想一口气答完。',
    form: '只有一只拇指和几分钟，所以按“要点几下”排：每个问题一个托盘，托盘几排就要点几下，按掉一下矮一排。',
    fig: d => [v(d.beat3.taps), `下答完 ${v(d.beat3.open)} 个问题`, 'beat3.taps'],
  },
  {
    id: 'watch', name: '腕上一瞥', where: '手表 · 2 秒', record: 'phone',
    situation: '会议间隙抬腕，两秒：要不要现在掏手机？',
    form: '两秒读不完一句话，只读得了一个数和一圈刻度：64 份卷成 64 格表圈，要紧的亮朱红，中间的数只数要紧的。',
    fig: d => [v(d.beat3.urgent).length, '件要紧', 'beat3.urgent.length'], ver: true,
  },
  {
    id: 'duo', name: '折叠屏', where: '折叠屏 · iPad 横 · 5 分钟', record: 'pad', better: '横屏 iPad 或电脑上更好',
    situation: '翻开折叠屏，想知道这几张卡是从哪来的。',
    form: '屏幕大了一倍，就把这一轮的原料摊在左页：采用的按落进哪件分组，一条线穿过折痕连到右页那张卡，没采用的灰着折在下面。',
    fig: d => [v(d.beat1.n), `条进来，${v(d.beat2.folded)} 条折掉`, 'beat1.n'],
  },
  {
    id: 'multiples', name: '两周小倍数', where: '大屏 · 10 分钟 · 不作答', record: 'pad', better: '横屏 iPad 或电脑上更好',
    situation: '周末复盘：这两周注意力花在哪了。',
    form: '要看的是走向，不是某一件：每一轮一张 8 × 8 = 64 格的小方阵，同尺度并排，不承载作答。',
    fig: d => [v(d.twoWeeks.roundsAtFull), `次用满 64 份（共 ${v(d.beat1.context.rounds)} 轮）`, 'twoWeeks.roundsAtFull'],
  },
  {
    id: 'b', name: '时间展开', where: 'iPad · 几分钟', record: 'pad', better: '横屏 iPad 或电脑上更好',
    situation: '想知道哪件事的期限先到，还剩多久。',
    form: '时间往右展开：此刻是一条竖线，每件事一条带、粗细是份额；期限落在此刻线之后的哪里，就标在哪里，谁先到一眼看出。',
    fig: d => [v(d.dueAhead)[0].hours, '小时后，最近的期限', 'dueAhead.0.hours'],
  },
]

// The rest, in the gallery's order: the smart glasses (newest, fine on a phone and a pad) and the original tree map
// first, then the ones still usable on a phone or a pad
// and the strongest pictures, the desk-only relation views by finish × representativeness, the component demo,
// and the eight forms withdrawn after round one. A prototype missing here (a new one) goes to the end.
export const GALLERY_ORDER = [
  'glasses', 'original', 'pulse', 'a', 'chain', 'c', 'morph', 'dial', 'timing', 'peak', 'yield', 'age', 'notation', 'tug',
  'lineage', 'provenance', 'khipu', 'respond', 'chat', 'radio', 'departures', 'blame', 'frontpage', 'receipt', 'strips', 'orb',
]

// Laid out for a 1440-wide desk: on a phone they shrink to 27–35 % (spec.md A).
export const DESK_ONLY = new Set(['lineage', 'timing', 'provenance', 'yield', 'notation', 'morph', 'peak', 'age', 'chain', 'tug', 'khipu'])

export function showcaseOf(prototypes) {
  const byId = new Map(prototypes.map(p => [p.id, p]))
  return TOP.filter(t => byId.has(t.id)).map(t => ({ ...t, prototype: byId.get(t.id) }))
}

export function galleryOf(prototypes) {
  const top = new Set(TOP.map(t => t.id))
  const rank = id => { const i = GALLERY_ORDER.indexOf(id); return i < 0 ? GALLERY_ORDER.length : i }
  return prototypes.filter(p => !top.has(p.id))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p.id) - rank(b.p.id) || a.i - b.i)
    .map(({ p }) => p)
}

// Opened on its own (a phone, or a new tab): no ?frame=, so the prototype tells its story once; forms keep
// ?card=0 so the concept card does not cover the picture. The link carries rel="noreferrer" for the same reason.
export function directHref(prototype) {
  const href = new URL(prototype.href, 'https://fold.invalid')
  const src = new URL(prototype.src, 'https://fold.invalid')
  href.searchParams.delete('frame')
  if (src.searchParams.get('card') === '0') href.searchParams.set('card', '0')
  return `${href.pathname}${href.search}`
}

// ---------- documents, grouped by reader (the landing's docs section and the nav's 文档 menu) ----------

export const DOC_GROUPS = [
  { title: '第一次了解', note: '五分钟到半小时', items: [
    ['为什么要做 Fold', '/docs/why', '从头读到尾：问题从哪来、为什么难、Fold 的判断、做到了哪'],
    ['项目概览', '/overview', '整体流程、当前阶段与阅读顺序'],
    ['产品方向', '/docs/product', '为什么做、核心体验、术语与成功信号'],
    ['用户故事', '/docs/user-stories', '五个完整情境：人看到什么、Agent 怎样整理'],
  ] },
  { title: '要实现或接入', note: '规范出处', items: [
    ['信息契约', '/docs/information-contract', '输入输出、份额、操作、批注与回执'],
    ['领域模型', '/docs/domain-model', '事件、反馈与时间信号的通用形式'],
    ['架构与持久化', '/docs/architecture', '模块、记录、锁、写入次序与恢复'],
    ['决策记录', '/docs/decisions', '首切片范围、实施顺序与未决问题'],
  ] },
  { title: '关心 Agent 的判断', note: 'skill 与评测', items: [
    ['Fold skill', '/skill/SKILL', '给使用 Fold 的 Agent 的判断指引，第二版'],
    ['Skill 设计', '/docs/skill-design', '何时调用、上下文视图与验证计划'],
    ['评测报告', '/docs/evaluations/README', '真实模型评测：设置、指标与结论'],
  ] },
  { title: '关心数据从哪来', note: '真实语料', items: [
    ['真实语料', '/corpus/README', '来源调查、许可、重建方法与弱标注'],
    ['混合人物语料', '/corpus/composite/MIX', 'Jonas 的两周：五条流的来源与改写'],
    ['演示数据打磨', '/prototype-notes/data/composite/POLISH', '自由运行怎样打磨成演示数据'],
  ] },
  { title: '想看形式怎么来的', note: '原型与形式', items: [
    ['原型说明', '/prototype-notes/README', '各种形式的场景、入口与共同操作'],
    ['概念卡', '/prototype-notes/forms/CONCEPTS', '每一轮形式的概念卡与结论'],
    ['灵感来源', '/prototype-notes/forms/INSPIRATION', '每种形式参考了什么'],
  ] },
  { title: '要动手', note: '开发', items: [
    ['工作环境', '/docs/development', 'make setup / check / test 与站点命令'],
    ['一致性用例', '/conformance/cases/', '六组用例：验收材料'],
    ['形式模型', '/docs/formal-model', '用数学检查预算与执行的关系'],
  ] },
]

// ---------- the first screen: one moment, a window that changes with where you are ----------
// The field is everything the Agent has read by f26 (data.hero.field): one column a round, one dot an input, in
// arrival order from the bottom. Each situation's window is encoded from part of it; the rest dims where it is.

export const SITUATIONS = [
  { k: 1, name: '骑车', time: '抬腕 2 秒' },
  { k: 2, name: '桌前', time: '坐下几分钟' },
  { k: 3, name: '复盘', time: '停下来半小时' },
]
// When things happen on the first screen, in ms from first paint (it plays once and stops on 复盘):
//   sweep  the two weeks are laid in, a round a column, left to right
//   s1–s3  the window takes the situation's shape; what it was not made from dims in place; its content re-encodes
export const MOMENT = { sweep: [100, 900], s: [1200, 3900, 6900], open: 420, morph: 650, fade: 140, dim: 450, lit: 300, rise: [450, 24] }
const PER = 5          // dots per row in a column
const STRIDE = PER + 1 // a column and its gap, in dots

// Short names for the tiles of the desk window (the replay's titles are a sentence each).
export const NAMES = {
  'driveway-wet': '主水管', 'issue-13587': '#13596', 'pr-reviews-0814': '三个旧 PR', 'ci-urls-master': 'master CI', 'smilla-vet': '猫看病',
  'kajsa-bike-brake': '车刹', 'mamma-stambyte': '妈妈换水管', 'issue-13586': '#13586', 'ture-pickup-0812': 'Ture', 'signe-school-start': 'Signe 开学',
  'signe-comic-talk': '漫画', 'fan-delivery-0815': '台扇', 'issue-13466': '#13466', 'release-8-22-rc1': 'rc1',
}

/** The field: dashed rows for every input (dimmed as one), and one layer per level for the inputs that stay lit. */
export function fieldSVG(d) {
  const cols = v(d.hero.field)
  const rows = Math.max(...cols.map(c => Math.ceil(c.length / PER)))
  const W = cols.length * STRIDE - 1
  // Paths in relative moves (each mark is a horizontal stroke `len` long starting at x, y): a quarter the size.
  const pen = () => { let px = 0, py = 0, out = ''; return { mark(x, y, len) { out += `${out ? 'm' : 'M'}${r(x - px, 2)} ${r(y - py, 2)}h${r(len, 2)}`; px = x + len; py = y }, get d() { return out } } }
  const base = pen(), lit = [null, pen(), pen(), pen(), pen()]
  cols.forEach((col, c) => {
    for (let row = 0; row * PER < col.length; row += 1) base.mark(c * STRIDE + 0.14, rows - 0.5 - row, Math.min(PER, col.length - row * PER) - 0.28)
    ;[...col].forEach((ch, i) => { const lv = Number(ch); if (lv) lit[lv].mark(c * STRIDE + (i % PER) + 0.14, rows - 0.5 - Math.floor(i / PER), 0.72) })
  })
  // One svg a layer, so each dims or lights as a whole (an opacity the compositor can run, not a repaint of the dots).
  const svg = (cls, path, extra = '') => `<svg class="h2-dots ${cls}" viewBox="0 0 ${W} ${rows}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"${extra}/></svg>`
  return svg('h2-base', base.d, ' stroke-dasharray=".72 .28"') + [1, 2, 3, 4].map(lv => svg(`h2-l${lv}`, lit[lv].d)).join('')
}

/** Squarified treemap of `items` ({v}) in a w × h box; returns the items with x, y, w, h. */
export function squarify(items, w, h) {
  const total = items.reduce((a, b) => a + b.v, 0)
  const list = items.map(o => ({ ...o, a: o.v * w * h / total }))
  const out = []
  let row = [], rx = 0, ry = 0, rw = w, rh = h
  const worst = (rs, side) => { const s = rs.reduce((a, b) => a + b.a, 0); return Math.max(...rs.map(x => Math.max(side * side * x.a / (s * s), s * s / (side * side * x.a)))) }
  const lay = rs => {
    const s = rs.reduce((a, b) => a + b.a, 0)
    if (rw >= rh) { const cw = s / rh; let y = ry; for (const x of rs) { out.push({ ...x, x: rx, y, w: cw, h: x.a / cw }); y += x.a / cw } rx += cw; rw -= cw }
    else { const ch = s / rw; let x0 = rx; for (const x of rs) { out.push({ ...x, x: x0, y: ry, w: x.a / ch, h: ch }); x0 += x.a / ch } ry += ch; rh -= ch }
  }
  for (const it of list) {
    const side = Math.min(rw, rh)
    if (!row.length || worst([...row, it], side) <= worst(row, side)) row.push(it)
    else { lay(row); row = [it] }
  }
  if (row.length) lay(row)
  return out
}

/** The desk window: this round's items as areas (the 原版树图's reading), the ones waiting for you in vermilion. */
export function deskHTML(d) {
  const segs = v(d.beat2.segments)
  const leadId = v(d.beat3.lead).item
  const blank = v(d.beat2.blank).now
  const W = 170, H = 100   // the window's aspect (1.7), in the same units on every screen
  const tiles = squarify([...segs.map((s, i) => ({ v: s.share, s, i })), ...(blank ? [{ v: blank, blank: true }] : [])], W, H)
  return `<div class="h2-desk">${tiles.map((t, n) => {
    const cls = t.blank ? 'blank' : t.s.turn === 'you' ? (t.s.id === leadId ? 'you lead' : 'you') : 'agent'
    // A name only where it fits on the narrowest desk window (330 px for the 170 units): 11.5 px a character.
    const name = t.blank ? '' : NAMES[t.s.id] || ''
    const fits = t.w * 330 / W >= [...name].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 11.5 : 6.6), 14) && t.h * 194 / H >= 22
    const label = name && fits ? `<b>${name}</b>` : ''
    return `<i class="tl ${cls}" style="--x:${r(t.x / W * 100, 2)};--y:${r(t.y / H * 100, 2)};--w:${r(t.w / W * 100, 2)};--h:${r(t.h / H * 100, 2)};--i:${n}">${label}</i>`
  }).join('')}</div>`
}

/** The review window: each round's items stacked by share, under the field's own columns. */
export function reviewSVG(d) {
  const rounds = v(d.hero.review)
  const segs = v(d.beat2.segments)
  const leadId = v(d.beat3.lead).item
  const W = rounds.length * STRIDE - 1, H = 64
  const tone = rank => (rank === 0 ? 'oklch(0.56 0.012 150)' : rank < 3 ? 'oklch(0.7 0.01 145)' : 'var(--agent)')
  // One path per colour per round (a round is one group, so it can rise as one).
  const cols = rounds.map(([, , shares], c) => {
    const by = new Map()
    let y = H
    shares.forEach((share, rank) => {
      const seg = c === rounds.length - 1 ? segs[rank] : null
      const fill = seg ? (seg.turn === 'you' ? (seg.id === leadId ? 'var(--ver)' : 'var(--ver-soft)') : 'var(--agent)') : tone(rank)
      y -= share
      by.set(fill, (by.get(fill) || '') + `M${c * STRIDE} ${r(y + 0.25, 2)}h${PER}v${r(share - 0.5, 2)}h-${PER}z`)
    })
    return `<g class="col" style="--c:${c}">${[...by].map(([fill, path]) => `<path fill="${fill}" d="${path}"/>`).join('')}</g>`
  }).join('')
  return `<svg class="h2-stack" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${cols}</svg>`
}

/**
 * The first screen's motion, from MOMENT: the CSS is generated so the times have one source. It plays once from
 * first paint (no script) and ends on the static 复盘 state; a tap on a situation (.manual) drops it for transitions.
 */
export function momentCSS() {
  const { sweep, s: [s1, s2, s3], open, morph, fade, dim, lit, rise } = MOMENT
  const T = s3 + morph + 1200
  const p = t => `${r(Math.max(0, Math.min(T, t)) / T * 100, 3)}%`
  // Visible from `on` to `off` (fading `fade` ms at each end); `off` null = to the end.
  const span = (name, on, off) => `@keyframes ${name} { 0%, ${p(on)} { opacity: 0; } ${p(on + fade * 2)}${off ? `, ${p(off)}` : ''} { opacity: 1; } ${off ? `${p(off + fade)}, 100% { opacity: 0; }` : '100% { opacity: 1; }'} }`
  const chip = (name, on, off) => `@keyframes ${name} { 0%, ${p(on)} { color: var(--ink-3); } ${p(on + 1)}${off ? `, ${p(off)}` : ''} { color: var(--ink); } ${off ? `${p(off + 1)}, 100% { color: var(--ink-3); }` : '100% { color: var(--ink); }'} }`
  const S = '.h2-stage:not(.manual)'
  return [
    span('h2-c1', s1 + 240, s2), span('h2-c2', s2 + morph - 60, s3), span('h2-c3', s3 + morph * 0.4, null),
    span('h2-g1', s1 + 240, s2), span('h2-g2', s2 + morph - 60, s3), span('h2-g3', s3 + morph * 0.4, null),
    chip('h2-k1', s1, s2), chip('h2-k2', s2, s3), chip('h2-k3', s3, null),
    `@keyframes h2-bar { 0%, ${p(s1)} { opacity: 0; transform: translateX(0); } ${p(s1 + 200)}, ${p(s2)} { opacity: 1; transform: translateX(0); } ${p(s2 + 400)}, ${p(s3)} { opacity: 1; transform: translateX(100%); } ${p(s3 + 400)}, 100% { opacity: 1; transform: translateX(200%); } }`,
    '@media (prefers-reduced-motion: no-preference) {',
    `${S} .h2-cover { animation: h2-sweep ${sweep[1]}ms linear ${sweep[0]}ms both; }`,
    `${S} .h2-base { animation: h2-dim ${dim}ms ease-out ${s1}ms both; }`,
    `${S} .h2-l4 { animation: h2-in ${lit}ms ease-out ${s1 + 150}ms both; }`,
    `${S} .h2-l3, ${S} .h2-l2 { animation: h2-in ${lit}ms ease-out ${s2 + 150}ms both; }`,
    `${S} .h2-l1 { animation: h2-in ${lit}ms ease-out ${s3 + 150}ms both; }`,
    `${S} .h2-win { animation: h2-open ${open}ms var(--e-out) ${s1}ms both, h2-12 ${morph}ms var(--e-yield) ${s2}ms forwards, h2-23 ${morph}ms var(--e-yield) ${s3}ms forwards; }`,
    `${S} .h2-c1 { animation: h2-c1 ${T}ms linear both; }`,
    `${S} .h2-c2 { animation: h2-c2 ${T}ms linear both; }`,
    `${S} .h2-c3 { animation: h2-c3 ${T}ms linear both; }`,
    `${S} .h2-c3 .col { animation: h2-rise ${rise[0]}ms var(--e-out) calc(${Math.round(s3 + morph * 0.4)}ms + var(--c) * ${rise[1]}ms) both; }`,
    `${S} .ch1 { animation: h2-k1 ${T}ms linear both; } ${S} .ch2 { animation: h2-k2 ${T}ms linear both; } ${S} .ch3 { animation: h2-k3 ${T}ms linear both; }`,
    `${S} .h2-bar { animation: h2-bar ${T}ms linear both; }`,
    `${S} .lg1 { animation: h2-g1 ${T}ms linear both; } ${S} .lg2 { animation: h2-g2 ${T}ms linear both; } ${S} .lg3 { animation: h2-g3 ${T}ms linear both; }`,
    '}',
  ].join('\n')
}

// ---------- why it is a new problem: one app's notifications against everything the Agent reads ----------

// The channels' own names, in Chinese where the replay keeps the Swedish app name.
export const CHANNEL_NAMES = {
  Bankappen: '银行 App', Förskoleappen: '幼儿园 App', Inköpslistan: '购物清单', Telefon: '电话', 'E-post': '邮件', Kalender: '日历',
  Skärmtid: '屏幕时间', Röstbrevlåda: '语音信箱', Skolappen: '学校 App', 'Digital brevlåda': '数字信箱', 'Trygghem Försäkring': '保险公司',
}
export const ONE_APP = 'Förskoleappen'

// ---------- the situations, by how much room each one gives (the third section) ----------

// Narrowest first: how long a look, how big a screen, whether you can answer there. `size` is the glyph's width
// in the ladder (px on a phone), so the windows visibly widen down the list.
export const LADDER = [
  { id: 'watch', size: 56, when: '抬腕 2 秒', room: '只读得了一个数', fig: d => [v(d.beat3.urgent).length, '件要紧', 'beat3.urgent.length'], ver: true },
  { id: 'd', size: 64, when: '掏手机 1 分钟', room: '一屏三张卡，一按就答', fig: d => [v(d.beat3.open), '件等你，最急的在上', 'beat3.open'], ver: true },
  { id: 'trays', size: 68, when: '通勤几分钟', room: '一只拇指，一口气答完', fig: d => [v(d.beat3.taps), `下答完 ${v(d.beat3.open)} 个问题`, 'beat3.taps'] },
  { id: 'b', size: 84, when: 'iPad 前几分钟', room: '看谁的期限先到', fig: d => [v(d.dueAhead)[0].hours, '小时后，最近的期限', 'dueAhead.0.hours'] },
  { id: 'duo', size: 96, when: '翻开折叠屏 5 分钟', room: '屏幕大一倍，摊开原料', fig: d => [v(d.beat1.n), `条原料摊开 → ${v(d.beat2.cardsFed)} 张卡`, 'beat1.n'] },
  { id: 'multiples', size: 108, when: '周末复盘 10 分钟', room: '不作答，只看走向', fig: d => [v(d.hero.itemsEver), `件事，${v(d.hero.rounds)} 次整理的走向`, 'hero.itemsEver'] },
]

// ---------- the stage: five lanes of real ticks over a 64-cell ruler, sharing one x-span ----------

export const LANES = [['work', '工作'], ['community', '社区'], ['life', '生活'], ['family', '家庭'], ['subscription', '订阅']]
const WINDOW_MINUTES = 720
const r = (n, d = 3) => Number(n.toFixed(d))

export function stageModel(d) {
  const segs = v(d.beat2.segments).map((s, rank) => ({ ...s, rank }))
  const blank = v(d.beat2.blank)
  const leadId = v(d.beat3.lead).item
  // Ruler order: your turn first (by rank), then the Agent's, then the blank: the account 38 + 25 + 1 = 64.
  const order = [...segs.filter(s => s.turn === 'you'), ...segs.filter(s => s.turn === 'agent')]
  const lay = key => { let c = 0; return new Map(order.map(s => { const at = { x: c / 64 * 100, w: s[key] / 64 * 100 }; c += s[key]; return [s.id, at] })) }
  const before = lay('before'), after = lay('share')
  const used = { before: 64 - blank.before, after: 64 - blank.now }
  const segments = order.map(s => ({
    id: s.id, title: s.title, turn: s.turn, lead: s.id === leadId, weight: s.weight, share: s.share, before: s.before,
    x: after.get(s.id).x, w: after.get(s.id).w, bx: before.get(s.id).x, bw: before.get(s.id).w,
  }))
  const ticks = v(d.beat1.ticks).map(([m, stream, to, target], i) => ({
    i, m, x: m / WINDOW_MINUTES * 100, lane: LANES.findIndex(l => l[0] === stream), to, target,
  }))
  // The 40 adopted inputs: each falls into its own item's segment, spread evenly across it in arrival order, and is
  // absorbed there. One went to an item withdrawn this round: it drops to the ruler and fades.
  const adopted = ticks.filter(t => t.to !== 'fold')
  const byItem = new Map()
  for (const t of adopted) {
    const id = typeof t.target === 'number' ? v(d.beat2.segments)[t.target]?.id : t.target
    if (!byItem.has(id)) byItem.set(id, [])
    byItem.get(id).push(t)
  }
  const dots = adopted.map((t, k) => {
    const id = typeof t.target === 'number' ? v(d.beat2.segments)[t.target]?.id : t.target
    const list = byItem.get(id), j = list.indexOf(t), n = list.length
    // Withdrawn this round: it has no segment, so it drops onto the ruler under its own tick and fades there.
    if (!after.get(id)) return { k, x0: t.x, lane: t.lane, gone: true, id }
    // f: where in its segment it lands: they converge on its middle (a narrow band, in arrival order), so the
    // inputs read as going into that one item rather than lining up along the ruler
    return { k, x0: t.x, lane: t.lane, f: n > 1 ? 0.5 + (j / (n - 1) - 0.5) * 0.36 : 0.5, id, you: t.to === 'you' }
  })
  const deltas = v(d.beat2.yielded).map(y => ({ ...y, ...after.get(y.id), title: segs.find(s => s.id === y.id)?.title }))
  return { segments, ticks, dots, deltas, used, blank, leadId, count: { n: ticks.length, adopted: adopted.length } }
}

// Short names for the few segments the stage labels.
export const SHORT = { 'driveway-wet': '主水管', 'smilla-vet': '猫看病', 'issue-13587': '#13596', 'kajsa-bike-brake': '车刹', 'ture-pickup-0812': 'Ture' }

/**
 * When things happen on the beat stage (the fourth section), in ms from the moment a beat starts.
 * The CSS reads the per-element times from inline variables, so this table is their single source:
 *   sweep   the 12 hours pass left to right and the ticks appear as the playhead reaches them
 *   fold    the 118 unadopted ticks shrink to stubs (and the Agent's shorten), in their lane groups
 *   squeeze (beats) the lanes compress towards the ruler
 *   drop    the 40 adopted inputs fall one after another (start, gap); each falls for `fall` ms, lands inside its
 *           own item's segment and is absorbed in `absorb` ms
 *   yield   the ruler re-divides on one curve while the dots arrive: an item grows as its inputs land in it
 */
export const TIMING = {
  beats: { sweep: [150, 1600], fold: 0, squeeze: [260, 600], drop: [900, 22], fall: 560, absorb: 190, yield: [1300, 1100] },
}
// The yield's curve (the CSS --e-yield), to know where a segment is when a dot reaches it.
const YIELD_CURVE = [0.65, 0, 0.35, 1]
export function bezier([x1, y1, x2, y2], x) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3
  let lo = 0, hi = 1, t = x
  for (let i = 0; i < 40; i += 1) { t = (lo + hi) / 2; if (at(x1, x2, t) < x) lo = t; else hi = t }
  return at(y1, y2, t)
}
// The share of a dot's animation spent falling; the rest is it being absorbed into its segment (the CSS fl-drop).
export const FALL_SHARE = 0.74

// A number that counts from `from` to `to` in step with the yield: a strip of every value in between, clipped to one
// line, that moves on one value each time the segment's width passes the next whole share on the yield's curve
// (keyframes fl-roll-<steps>, from rollKeyframes). The final value is also in a visually hidden twin (for data-k).
function roll(from, to, key) {
  const step = to >= from ? 1 : -1
  const values = []
  for (let n = from; ; n += step) { values.push(n); if (n === to) break }
  const twin = key ? `<span class="fl-sr" data-k="${key}">${to}</span>` : ''
  return `${twin}<span class="roll" aria-hidden="true" style="--steps:${values.length - 1};--roll:fl-roll-${values.length - 1}"><span class="rs">${values.join('<br>')}</span></span>`
}
// The inverse of the yield's curve: when (as a share of its duration) it reaches progress y.
function curveTime(y) {
  let lo = 0, hi = 1
  for (let i = 0; i < 40; i += 1) { const m = (lo + hi) / 2; if (bezier(YIELD_CURVE, m) < y) lo = m; else hi = m }
  return (lo + hi) / 2
}
// One @keyframes per strip length: hold each value until the curve passes halfway to the next, then step.
export function rollKeyframes(counts) {
  return [...new Set(counts)].sort((a, b) => a - b).map(n => {
    const frames = ['0% { transform: translateY(0); }']
    for (let i = 0; i < n; i += 1) {
      const at = curveTime((i + 0.5) / n) * 100
      frames.push(`${at.toFixed(2)}% { transform: translateY(calc(${-i} * var(--rl))); }`, `${(at + 0.01).toFixed(2)}% { transform: translateY(calc(${-(i + 1)} * var(--rl))); }`)
    }
    frames.push(`100% { transform: translateY(calc(${-n} * var(--rl))); }`)
    return `@keyframes fl-roll-${n} { ${frames.join(' ')} }`
  }).join('\n')
}

/**
 * The beat stage's inner HTML (scroll-triggered: FoldLanding.vue sets the state classes); `mode` is 'beats'. Every position is a share of the plot's width
 * (x, in % / cqw) or a CSS variable (y), so the server-rendered page needs no viewport.
 *
 * The ticks sit in one group per lane and destination (yours, the Agent's, folded) inside a window that slides open
 * with the playhead: a handful of animations instead of one per tick. Each dot is one element that falls, lands
 * inside its own segment where that segment is at that moment, and is absorbed.
 */
export function stageHTML(d, mode) {
  const m = stageModel(d)
  const T = TIMING[mode]
  const streams = v(d.beat1.streams)
  const lab = LANES.map(([id, name], l) => `<span class="fl-lab" style="--l:${l}">${name}<b data-k="beat1.streams.${id}">${streams[id]}</b></span>`).join('')
  const lanes = LANES.map((_, l) => `<i class="fl-ln" style="--l:${l}"></i>`).join('')
  const groups = LANES.map((_, l) => {
    const of = to => m.ticks.filter(t => t.lane === l && t.to === to).map(t => `<i style="--x:${r(t.x)}"></i>`).join('')
    return `<div class="fl-lane" style="--l:${l}"><div class="g y">${of('you')}</div><div class="g a">${of('agent')}</div><div class="g f">${of('fold')}</div></div>`
  }).join('')
  const sweep = `<div class="fl-sweep"><div class="fl-sweep-in">${groups}</div><i class="fl-head"></i></div>`
  const axis = [[0, '12:00'], [180, '15:00'], [360, '18:00'], [540, '21:00'], [720, '00:00']]
    .map(([min, text]) => `<span style="--x:${r(min / WINDOW_MINUTES * 100)}">${text}</span>`).join('')

  // Where every dot lands: inside its own segment, where that segment is at the moment it arrives.
  const [d0, gap] = T.drop
  const [y0, yd] = T.yield
  const dur = Math.round(T.fall / FALL_SHARE)
  const landAt = k => d0 + k * gap + T.fall
  const progress = t => bezier(YIELD_CURVE, (t - y0) / yd)
  const byId = new Map(m.segments.map(s => [s.id, s]))
  const arrivals = new Map()
  const dots = m.dots.map(t => {
    const s = byId.get(t.id)
    let xl = t.x0
    if (s) {
      const q = progress(landAt(t.k))
      xl = s.bx + (s.x - s.bx) * q + (s.bw + (s.w - s.bw) * q) * t.f
      if (!arrivals.has(s.id)) arrivals.set(s.id, [])
      arrivals.get(s.id).push(landAt(t.k))
    }
    return `<i class="dt${t.gone ? ' gone' : ''}" style="--x0:${r(t.x0)};--xl:${r(xl)};--l:${t.lane};--d:${d0 + t.k * gap}ms"></i>`
  }).join('')
  // A segment darkens while its inputs land in it.
  const flash = id => {
    const list = arrivals.get(id)
    if (!list) return ''
    const a = Math.min(...list), b = Math.max(...list)
    return `<i class="h" style="--fa:${a - 60}ms;--fd:${b - a + T.absorb + 200}ms"></i>`
  }
  const segs = m.segments.map(s => `<div class="sg ${s.turn}${s.lead ? ' lead' : ''}" style="--x:${r(s.x)};--w:${r(s.w)};--bx:${r(s.bx)};--bw:${r(s.bw)}" data-id="${s.id}"><i class="f"></i>${s.turn === 'you' ? '<i class="v"></i>' : ''}${flash(s.id)}${s.lead ? '<i class="done">答过 · 等读到</i>' : ''}</div>`).join('')
  const ruler = `<div class="fl-ruler"><div class="fl-bar"><div class="fl-segs">${segs}</div></div><i class="fl-scale"></i></div>`
  const times = `--yt:${y0}ms;--yd:${yd}ms;--dd:${dur}ms`

  // Who gave to whom: the items that grew on one row, the ones that gave way (and the blank) on the row below. On a
  // desk each sits under its segment; on a phone each row flows (CSS), so the labels never run into each other.
  const delta = x => `<span class="dl" data-id="${x.id}" style="--x:${r(x.x + x.w / 2)}">${SHORT[x.id] || ''} ${x.before}→${roll(x.before, x.share)}</span>`
  const deltas = `<div class="up">${m.deltas.filter(x => x.delta > 0).map(delta).join('')}</div>`
    + `<div class="down">${m.deltas.filter(x => x.delta < 0).map(delta).join('')}`
    + `<span class="dl blank" style="--x:100">空余 <span data-k="beat2.blank.before">${m.blank.before}</span>→${roll(m.blank.before, m.blank.now, 'beat2.blank.now')}</span></div>`
  const rolls = [...m.deltas.map(x => Math.abs(x.share - x.before)), Math.abs(m.blank.now - m.blank.before)]
  const lead = m.segments.find(s => s.lead)
  return `<div class="fl-gutter" aria-hidden="true" style="${times}">${lab}<span class="fl-lab-r">64 份</span><span class="fl-lab-d up">涨</span><span class="fl-lab-d down">让</span></div>`
    + `<div class="fl-plot" style="${times};--lx:${r(lead.x)};--lw:${r(lead.w)}"><style>${rollKeyframes(rolls)}</style><div class="fl-lanes">${lanes}${sweep}</div><div class="fl-axis" aria-hidden="true">${axis}</div>${ruler}<div class="fl-dots">${dots}</div>`
    + `<div class="fl-deltas" aria-hidden="true">${deltas}</div>`
    + `<div class="fl-prev" aria-hidden="true">上一轮 · 已用 ${m.used.before} 份 · 空余 ${m.blank.before}</div>`
    + '<i class="fl-lead brace"></i><i class="fl-lead stem"></i><i class="fl-ret b"></i><i class="fl-ret v"></i><i class="fl-ret t"></i>'
    + '</div>'
}

// ---------- the six glyphs of the third section: the same f26 state as each situation's prototype draws it ----------

export function glyphs(d) {
  const segs = v(d.beat2.segments)
  const leadId = v(d.beat3.lead).item
  const asks = v(d.beat3.asks)
  const ticks = v(d.beat1.ticks)
  const tone = s => s.turn === 'you' ? (s.id === leadId ? 'var(--ver)' : 'var(--ver-soft)') : 'var(--agent)'
  const W = 120
  const svg = body => `<svg viewBox="0 0 ${W} ${W}" aria-hidden="true">${body}</svg>`

  // D: a phone outline, three cards stacked, the first in vermilion with its two buttons; “+2” more below.
  const home = (() => {
    let s = `<rect class="g-frame" x="${W / 2 - 31}" y="4" width="62" height="${W - 8}" rx="11"/>`
    let y = 16
    asks.slice(0, 3).forEach((a, i) => {
      const h = i === 0 ? 34 : 19
      s += `<g class="g-a" style="--i:${i}"><rect x="${W / 2 - 25}" y="${y}" width="50" height="${h}" rx="4" fill="none" stroke="${i === 0 ? 'var(--ver)' : 'var(--ink-3)'}" stroke-width="${i === 0 ? 1.4 : 1}"/>`
      s += `<rect x="${W / 2 - 20}" y="${y + 6}" width="${i === 0 ? 40 : 30}" height="3" rx="1.5" fill="var(--ink)"/>`
      if (i === 0) s += `<rect x="${W / 2 - 20}" y="${y + h - 11}" width="18" height="6" rx="2.5" fill="none" stroke="var(--ver)" stroke-width="1.2"/><rect x="${W / 2 + 2}" y="${y + h - 11}" width="18" height="6" rx="2.5" fill="none" stroke="var(--ver)" stroke-width="1.2"/>`
      s += '</g>'
      y += h + 5
    })
    return svg(`${s}<text class="g-a" style="--i:3" x="${W / 2}" y="${y + 12}" text-anchor="middle">+${asks.length - 3}</text>`)
  })()

  // 回应托盘: one tray per question, as tall as the taps it takes; the tap count as ticks on the right.
  const trays = (() => {
    let s = ''; let y = 9
    asks.forEach((a, i) => {
      const h = 9 + (a.taps - 1) * 11
      s += `<g class="g-a g-rise" style="--i:${i}"><rect x="22" y="${y}" width="66" height="${h}" rx="3.5" fill="none" stroke="${a.item === leadId ? 'var(--ver)' : 'var(--ink-2)'}" stroke-width="1.2"/>`
      for (let t = 0; t < a.taps; t += 1) s += `<rect x="94" y="${y + 1.5 + t * 11}" width="3" height="6" fill="var(--ink)"/>`
      s += '</g>'
      y += h + 6
    })
    return svg(s)
  })()

  // 腕上一瞥: 64 ticks round a dial, clockwise by rank; the urgent one lit, the count in the middle.
  const watch = (() => {
    const c = W / 2, r0 = W * 0.34, r1 = W * 0.45
    let s = ''; let cell = 0
    const tick = (col, i) => { const a = -Math.PI / 2 + (i + 0.5) / 64 * Math.PI * 2; return `<line class="g-a g-tick" style="--i:${i}" x1="${r(c + r0 * Math.cos(a), 2)}" y1="${r(c + r0 * Math.sin(a), 2)}" x2="${r(c + r1 * Math.cos(a), 2)}" y2="${r(c + r1 * Math.sin(a), 2)}" stroke="${col}"/>` }
    for (const it of segs) for (let k = 0; k < it.share; k += 1, cell += 1) s += tick(it.turn === 'you' ? (it.id === leadId ? 'var(--ver)' : 'var(--ver-soft)') : 'var(--ink-3)', cell)
    for (; cell < 64; cell += 1) s += tick('var(--rule)', cell)
    return svg(`${s}<text class="g-num" x="${c}" y="${c + 14}" text-anchor="middle">${v(d.beat3.urgent).length}</text>`)
  })()

  // E 折叠屏: the left page holds this round's 158 ticks (tall: to you, mid: the Agent's, short: folded);
  // three lines cross the fold to three cards on the right page.
  const duo = (() => {
    let s = `<rect class="g-frame" x="3" y="18" width="${W - 6}" height="84" rx="8"/><line x1="${W / 2}" x2="${W / 2}" y1="18" y2="102" stroke="var(--ink-3)" stroke-dasharray="2 2"/>`
    const gw = W / 2 - 14
    s += '<g class="g-a g-rise" style="--i:0">'
    for (const [m, , to] of ticks) { const h = to === 'you' ? 14 : to === 'agent' ? 8 : 3; s += `<rect x="${r(9 + m / 720 * gw, 1)}" y="${48 - h}" width=".8" height="${h}" fill="${to === 'fold' ? 'var(--fold)' : 'var(--ink)'}"/>` }
    s += '</g>'
    for (let i = 0; i < 3; i += 1) s += `<g class="g-a" style="--i:${i + 1}"><line x1="${9 + gw * (0.3 + i * 0.25)}" y1="${56 + i * 12}" x2="${W / 2 + 7}" y2="${38 + i * 22}" stroke="var(--ink-2)" stroke-width=".8"/><rect x="${W / 2 + 7}" y="${29 + i * 22}" width="${gw}" height="18" rx="3" fill="none" stroke="var(--ver)" stroke-width="${i === 0 ? 1.4 : 1}"/></g>`
    return svg(s)
  })()

  // 两周小倍数: one round as an 8 × 8 = 64 square, filled by item in rank order; the blank cell left empty.
  const grid = (() => {
    const g = 8, cs = 12, ox = (W - g * cs) / 2, oy = (W - g * cs) / 2
    const shades = ['oklch(0.4 0.012 155)', 'oklch(0.52 0.01 150)', 'oklch(0.63 0.01 145)', 'oklch(0.72 0.008 140)', 'oklch(0.8 0.008 140)']
    let s = ''; let cell = 0
    segs.forEach((it, i) => { for (let k = 0; k < it.share; k += 1, cell += 1) s += `<rect class="g-a g-cell" style="--i:${cell}" x="${ox + (cell % g) * cs}" y="${oy + Math.floor(cell / g) * cs}" width="${cs - 1.5}" height="${cs - 1.5}" fill="${shades[Math.min(4, i)]}"/>` })
    for (; cell < 64; cell += 1) s += `<rect class="g-a g-cell" style="--i:${cell}" x="${ox + (cell % g) * cs + 0.5}" y="${oy + Math.floor(cell / g) * cs + 0.5}" width="${cs - 2.5}" height="${cs - 2.5}" fill="none" stroke="var(--ink-3)" stroke-width=".8"/>`
    return svg(s)
  })()

  // B 时间展开: the now line on the left, every item a band as thick as its share; the bands whose deadline falls
  // after now run out to it (a marker), on a log time axis: 1 day, 1 week. The rest stop at the now line.
  const timeline = (() => {
    const x0 = 22, x1 = W - 6, y0 = 10, H = 92
    const hx = h => x0 + (x1 - x0) * Math.log1p(h / 6) / Math.log1p(300 / 6)
    const due = new Map(v(d.dueAhead).map(x => [x.id, x.hours]))
    let s = ''; let y = y0
    segs.forEach((it, i) => {
      const h = Math.max(0.9, it.share / 64 * H)
      s += `<rect x="${x0 - 9}" y="${r(y, 2)}" width="8" height="${r(Math.max(0.6, h - 0.8), 2)}" fill="${tone(it)}"/>`
      if (due.has(it.id)) {
        const xe = hx(due.get(it.id)), mid = y + h / 2
        s += `<g class="g-a g-band" style="--i:${i}"><rect x="${x0}" y="${r(y, 2)}" width="${r(xe - x0, 2)}" height="${r(Math.max(0.6, h - 0.8), 2)}" fill="${tone(it)}" opacity=".55"/><line x1="${r(xe, 2)}" x2="${r(xe, 2)}" y1="${r(mid - 6, 2)}" y2="${r(mid + 6, 2)}" stroke="${it.turn === 'you' ? 'var(--ver)' : 'var(--ink-2)'}" stroke-width="1.4"/></g>`
      }
      y += h
    })
    s += `<line x1="${x0}" x2="${x0}" y1="${y0 - 4}" y2="${y0 + H + 4}" stroke="var(--ink)" stroke-width="1.2"/>`
    s += [[24, '1 天'], [168, '1 周']].map(([h, t]) => `<line x1="${r(hx(h), 2)}" x2="${r(hx(h), 2)}" y1="${y0 + H + 2}" y2="${y0 + H + 6}" stroke="var(--ink-3)"/><text x="${r(hx(h), 2)}" y="${y0 + H + 15}" text-anchor="middle">${t}</text>`).join('')
    return svg(s)
  })()

  return { d: home, trays, watch, duo, multiples: grid, b: timeline }
}

// The third section's ladder: the six situations from the narrowest to the widest, each with its glyph and the one
// number its prototype shows for f26. Each row links to its card below.
export function ladderOf(d) {
  const g = glyphs(d)
  const name = id => TOP.find(t => t.id === id)?.name
  return LADDER.map(l => ({ ...l, name: name(l.id), svg: g[l.id], figure: l.fig(d) }))
}
