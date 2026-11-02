// The landing page (FoldLanding.vue): which prototypes it shows and in what order, what each card says, and the
// geometry of the stage and the bridge glyphs, all computed from site/landing/data.json (the f26 replay).
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

// The rest, in the gallery's order: the original tree map first, then the ones still usable on a phone or a pad
// and the strongest pictures, the desk-only relation views by finish × representativeness, the component demo,
// and the eight forms withdrawn after round one. A prototype missing here (a new one) goes to the end.
export const GALLERY_ORDER = [
  'original', 'pulse', 'a', 'chain', 'c', 'morph', 'dial', 'timing', 'peak', 'yield', 'age', 'notation', 'tug',
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
    ['小册子', '/docs/brief/index.html', '16 页图文：问题、假设、真实数据、评测与形式'],
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
  // The 40 adopted inputs: each falls into its own item's segment, spread evenly across it in arrival order, and
  // rides along when the segments yield. One went to an item withdrawn this round: it drops to the ruler and fades.
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
    const b = before.get(id), a = after.get(id)
    // Withdrawn this round: it has no segment, so it drops to the axis under its own tick and fades there.
    if (!a) return { k, x0: t.x, lane: t.lane, xb: t.x, xa: t.x, gone: true, id }
    return { k, x0: t.x, lane: t.lane, xb: b.x + b.w * (j + 0.5) / n, xa: a.x + a.w * (j + 0.5) / n, id, you: t.to === 'you' }
  })
  const deltas = v(d.beat2.yielded).map(y => ({ ...y, ...after.get(y.id), title: segs.find(s => s.id === y.id)?.title }))
  return { segments, ticks, dots, deltas, used, blank, leadId, count: { n: ticks.length, adopted: adopted.length } }
}

// Short names for the few segments the stage labels.
export const SHORT = { 'driveway-wet': '主水管', 'smilla-vet': '猫看病', 'issue-13587': '#13596', 'kajsa-bike-brake': '车刹', 'ture-pickup-0812': 'Ture' }

/**
 * The stage's inner HTML. `mode` is 'hero' (the first screen builds it once by itself, CSS only) or 'beats'
 * (scroll-triggered, FoldLanding.vue sets data-step and play classes). Every position is a share of the plot's
 * width (x, in % / cqw) or a CSS variable (y), so the server-rendered page needs no viewport.
 */
export function stageHTML(d, mode) {
  const m = stageModel(d)
  const streams = v(d.beat1.streams)
  const lab = LANES.map(([id, name], l) => `<span class="fl-lab" style="--l:${l}">${name}<b data-k="beat1.streams.${id}">${streams[id]}</b></span>`).join('')
  const lanes = LANES.map((_, l) => `<i class="fl-ln" style="--l:${l}"></i>`).join('')
  const ticks = m.ticks.map(t => `<i class="tk ${t.to[0]}" style="--x:${r(t.x)};--l:${t.lane};--t:${r(t.m / WINDOW_MINUTES)}"></i>`).join('')
  const axis = [[0, '12:00'], [180, '15:00'], [360, '18:00'], [540, '21:00'], [720, '00:00']]
    .map(([min, text]) => `<span style="--x:${r(min / WINDOW_MINUTES * 100)}">${text}</span>`).join('')
  const segs = m.segments.map(s => `<div class="sg ${s.turn}${s.lead ? ' lead' : ''}" style="--x:${r(s.x)};--w:${r(s.w)};--bx:${r(s.bx)};--bw:${r(s.bw)}" data-id="${s.id}"><i class="f"></i>${s.turn === 'you' ? '<i class="v"></i>' : ''}${s.lead && mode !== 'hero' ? '<i class="done">答过 · 等读到</i>' : ''}</div>`).join('')
  const dots = m.dots.map(t => `<i class="dt${t.gone ? ' gone' : ''}" style="--x0:${r(t.x0)};--l:${t.lane};--xb:${r(t.xb)};--xa:${r(t.xa)};--k:${t.k}"><i><b></b></i></i>`).join('')
  const ruler = `<div class="fl-ruler"><div class="fl-bar">${segs}</div><i class="fl-scale"></i></div>`
  if (mode === 'hero') {
    return `<div class="fl-gutter" aria-hidden="true">${lab}</div><div class="fl-plot"><div class="fl-lanes">${lanes}${ticks}</div>${ruler}<div class="fl-dots">${dots}</div></div>`
  }
  // Who gave to whom: the items that grew on one row, the ones that gave way (and the blank) on the row below.
  const deltas = m.deltas.map(x => `<span class="dl ${x.delta > 0 ? 'up' : 'down'}" data-id="${x.id}" style="--x:${r(x.x + x.w / 2)}">${SHORT[x.id] || ''} ${x.before}→${x.share}</span>`).join('')
    + `<span class="dl down blank" style="--x:100">空余 <span data-k="beat2.blank.before">${m.blank.before}</span>→<span data-k="beat2.blank.now">${m.blank.now}</span></span>`
  const lead = m.segments.find(s => s.lead)
  return `<div class="fl-gutter" aria-hidden="true">${lab}<span class="fl-lab-r">64 份</span><span class="fl-lab-d up">涨</span><span class="fl-lab-d down">让</span></div>`
    + `<div class="fl-plot" style="--lx:${r(lead.x)};--lw:${r(lead.w)}"><div class="fl-lanes">${lanes}${ticks}</div><div class="fl-axis" aria-hidden="true">${axis}</div>${ruler}<div class="fl-dots">${dots}</div>`
    + `<div class="fl-deltas" aria-hidden="true">${deltas}</div>`
    + `<div class="fl-prev" aria-hidden="true">上一轮 · 已用 ${m.used.before} 份 · 空余 ${m.blank.before}</div>`
    + '<i class="fl-lead brace"></i><i class="fl-lead stem"></i><i class="fl-ret b"></i><i class="fl-ret v"></i><i class="fl-ret t"></i>'
    + '</div>'
}

// ---------- the bridge: the same f26 shares drawn six ways, in the showcase's order ----------

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
    const shades = ['var(--ink)', 'oklch(0.36 0.012 155)', 'oklch(0.5 0.01 150)', 'oklch(0.62 0.01 145)', 'oklch(0.74 0.008 140)']
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

// The bridge's caption under each glyph: name, how long a look it is, and its number.
export function bridgeOf(d) {
  const g = glyphs(d)
  return [
    { id: 'd', name: '手机首页', time: '1 分钟', fig: `${v(d.beat3.open)} 件等你`, ver: true, svg: g.d },
    { id: 'trays', name: '回应托盘', time: '几分钟', fig: `${v(d.beat3.taps)} 下答完`, svg: g.trays },
    { id: 'watch', name: '腕上一瞥', time: '2 秒', fig: `${v(d.beat3.urgent).length} 件要紧`, ver: true, svg: g.watch },
    { id: 'duo', name: '折叠屏', time: '5 分钟', fig: `${v(d.beat1.n)} → ${v(d.beat2.cardsFed)} 张卡`, svg: g.duo },
    { id: 'multiples', name: '两周小倍数', time: '10 分钟', fig: '8 × 8 = 64', svg: g.multiples },
    { id: 'b', name: '时间展开', time: '几分钟', fig: `最近 ${v(d.dueAhead)[0].hours} 小时`, svg: g.b },
  ]
}
