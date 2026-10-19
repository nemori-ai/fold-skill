import { createResponseStore, responseStatus, normalizeAsk, setTimeZone } from '../respond.mjs';
import { itemFacts, shortOf, hero } from './motion/dial-model.mjs';
import { createIx, placeBeside, placeColumn, edgePoint, IX } from './motion/ix.mjs';
import { withDataset } from '../data/select.mjs';

// 01 腕上一瞥：抬腕两秒，只回答“要不要现在掏手机”。
// 表盘只数要紧的问题：24 小时内到期（含已过期）或档位为 critical / high；其余问题只记一个“可以晚点”的数。
// 表圈 64 格，一格一份，按排名顺时针点亮；朱红只给登记了回应路径的事项，要紧的最亮。
// 表上只承载 confirm 与二选一的 choose；批准、回复、定时间都交给手机。点按只在本页演示，不写回状态：
// 先“已保存”，推进到下一轮整理后变为“已收到”，可以撤回。
// 换轮走三拍（polish/watch-motion.md「故事」）：0 秒切点只换时间；重分（0–0.65 秒）本轮输入化成灰点落向表圈，
// 64 格从 0 点顺时针逐格换主人；一闪（0.7–1.1 秒）新变得要紧的那几件亮一下、其余压暗、外沿轻敲；落定（1.1–1.5 秒）
// 中间的数滚到新值。←/→、选帧、连播与合页顶栏选帧都走这三拍；作答、撤回、翻张不是换轮，当场更新。
// 悬停刻度段、表盘下的事项名或表盘中间的短问法看概要，点击展开详情（共用 motion/ix.mjs）；两者都让换轮与连播停在当前时刻。
// 自动讲一遍：只在顶层直接打开、地址不带 ?frame= 时演一次（停在样张轮的前一轮，换到样张轮走完三拍，再悬停最急的那件），
// 任意键或点按跳过；页底有“重演”。画廊、合页、体验站弹框与从别处链来都不演。
const HOUR = 3600000, DAY = 86400000;
const WEIGHT_RANK = { critical: 0, high: 1, normal: 2, low: 3, trace: 4 };
const EASE = 'cubic-bezier(.2,.75,.25,1)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const span = ms => { const abs = Math.abs(ms); return abs < HOUR ? `${Math.max(1, Math.round(abs / 60000))} 分钟` : abs < 2 * DAY ? `${Math.round(abs / HOUR)} 小时` : `${Math.round(abs / DAY)} 天`; };
const chars = text => [...String(text || '')];
/** ≤16 characters for the wrist: the dataset's `short` when it has one, else the clause after the last colon, else a cut. */
export function shortAsk(ask, item) {
  if (ask.short) return ask.short;
  const prompt = String(ask.prompt || item?.title || '').trim();
  if (chars(prompt).length <= 16) return prompt;
  const tail = prompt.split(/[：:]/).at(-1).trim();
  if (tail && chars(tail).length <= 16 && chars(tail).length >= 4) return tail;
  return `${chars(prompt).slice(0, 15).join('')}…`;
}

// ---------- the turn: seconds from the cut ----------
const BEAT = { grains: 0.5, sweep: 0.15, swept: 0.65, flash: 0.7, flashed: 1.1, settle: 1.1, end: 1.5 };
const PLAY = 5.6;   // seconds a round when playing on, counted from the cut
// Tick radii in the ring's viewBox units (260 across); the hit band runs from HIT_IN to 14 px past the rim.
const R0 = 106, R1 = 122, RM = 114, HIT_IN = 100, HIT_OUT = 14;
// Stroke, width (viewBox units) and opacity of a tick by level: vermilion only for items that ask you something.
const LOOK = { item: ['#e9e6dc', 3, 0.55], ask: ['#ff5a36', 3, 0.42], hot: ['#ff5a36', 4.6, 1], done: ['#f3f1ea', 4.6, 0.9], blank: ['#333333', 2, 1] };
const FLASH = [255, 222, 210];
const ALL = Object.freeze({ inputs: true, share: true, asks: true });
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
const easeInOut = k => { k = clamp(k); return k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2; };
// 0 before a, up to 1 by b, held to c, back to 0 by d.
const bump = (t, a, b, c, d) => (t <= a || t >= d ? 0 : t < b ? easeOut((t - a) / (b - a)) : t <= c ? 1 : 1 - easeInOut((t - c) / (d - c)));
const angleOf = k => ((k + 0.5) / 64) * TAU - Math.PI / 2;
const hash = text => { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return (h >>> 0) / 4294967296; };
const mix = (hex, to, k) => `rgb(${[1, 3, 5].map((p, i) => Math.round(lerp(parseInt(hex.slice(p, p + 2), 16), to[i], k))).join(' ')})`;
const pathD = pts => (pts?.length ? `M${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}` : '');
const arcD = (cx, cy, r, a0, a1) => {
  const p = a => `${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`;
  return `M${p(a0)}A${r.toFixed(2)},${r.toFixed(2)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
};

export function mount(stage, model, kit) {
  const { esc, formatTime, formatDate } = kit;
  setTimeZone(kit.scenario.timeZone || 'Asia/Shanghai');
  const store = createResponseStore();
  const last = kit.scenario.frames.length - 1;
  let front = 0, s = model.snapshot(), lastIndex = -1;

  stage.innerHTML = `<div class="w-wrap">
    <p class="w-lede"><b class="w-lede-q">要不要现在掏手机？</b><span class="w-lede-a"></span></p>
    <div class="w-row">
      <figure class="w-fig w-fig-face"><div class="w-case"><div class="w-screen w-face" role="img" aria-label="表盘"><svg class="w-ring" viewBox="-130 -130 260 260" aria-hidden="true"><g class="w-glow">${'<path/>'.repeat(4)}</g><g class="w-ticks"></g><g class="w-grains"></g></svg>
          <div class="w-center"><div class="w-time"></div><div class="w-count"><span class="w-n"></span><span class="w-n is-old" aria-hidden="true"></span></div><div class="w-unit"></div><div class="w-comp"></div></div>
          <span class="w-pulse" aria-hidden="true"></span></div></div>
        <ol class="w-names" aria-label="表圈上份额最大的几件"></ol>
        <figcaption><b>抬腕</b><span class="w-cap-face"></span><span class="w-haptic"></span></figcaption></figure>
      <figure class="w-fig"><div class="w-case"><div class="w-screen w-stack" tabindex="0" aria-label="要紧的问题，按上下键翻"></div><button type="button" class="w-crown" data-w="crown" aria-label="转表冠：下一张"></button></div>
        <figcaption><b>转表冠</b><span class="w-cap-stack"></span><span class="w-crown-hint"><kbd>↑</kbd><kbd>↓</kbd> 或滚轮翻张 <button type="button" class="w-next" data-w="crown">下一张 ↓</button></span></figcaption></figure>
      <figure class="w-fig"><div class="w-case"><div class="w-screen w-reply" aria-live="polite"></div></div>
        <figcaption><b>点开</b><span class="w-cap-reply">表上只答“是/否”和二选一；批准、回复、定时间交给手机。按下只在本页演示，不写回状态。</span></figcaption></figure>
    </div>
    <p class="w-keys"><span class="w-keys-t"></span><button type="button" class="w-replay" data-w="replay" hidden>重演</button></p>
    <svg class="w-over" aria-hidden="true"><g class="w-pop"></g><path class="w-focus"/><path class="w-halo w-xhalo" pathLength="1"/><path class="w-xline" pathLength="1"/><path class="w-halo w-phalo"/><path class="w-pline"/></svg></div>`;
  const $ = selector => stage.querySelector(selector);
  const wrap = $('.w-wrap'), caseEl = $('.w-fig-face .w-case'), ring = $('.w-ring'), lede = $('.w-lede'), names = $('.w-names');
  const el = {
    time: $('.w-time'), count: $('.w-count'), n: $('.w-n'), nOld: $('.w-n.is-old'), unit: $('.w-unit'), comp: $('.w-comp'), face: $('.w-face'),
    ledeQ: $('.w-lede-q'), ledeA: $('.w-lede-a'), pulse: $('.w-pulse'), haptic: $('.w-haptic'), capFace: $('.w-cap-face'),
    pop: $('.w-pop'), focus: $('.w-focus'), xline: $('.w-xline'), xhalo: $('.w-xhalo'), pline: $('.w-pline'), phalo: $('.w-phalo'),
    grains: $('.w-grains'), glow: [...$('.w-glow').children],
  };
  $('.w-ticks').innerHTML = Array.from({ length: 64 }, (_, k) => {
    const a = angleOf(k), c = Math.cos(a), sn = Math.sin(a);
    return `<line x1="${(c * R0).toFixed(1)}" y1="${(sn * R0).toFixed(1)}" x2="${(c * R1).toFixed(1)}" y2="${(sn * R1).toFixed(1)}"/>`;
  }).join('');
  const ticks = [...$('.w-ticks').children];

  // ---------- what counts ----------
  const dueOf = (item, ask) => { const v = ask?.due_at || (item.kind !== 'done' ? item.due_at : null); const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
  const isUrgent = ({ item, ask }) => { const due = dueOf(item, ask); return (due != null && due - s.cursor < DAY) || (WEIGHT_RANK[item.weight] ?? 2) <= 1; };
  function urgencyKey({ item, ask }) { const due = dueOf(item, ask); return [WEIGHT_RANK[item.weight] ?? 2, due != null && due - s.cursor < DAY ? 0 : 1, due ?? Infinity, -item.share]; }
  const byUrgency = (a, b) => { const x = urgencyKey(a), y = urgencyKey(b); for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };
  /** Answerable on the wrist: confirm, or a choose/confirm with exactly two buttons that are decisions or actions. */
  function wristChoices(ask) {
    const n = normalizeAsk(ask), choices = n.actions.filter(a => a.meaning === 'decide' || a.meaning === 'act');
    if (n.expects === 'confirm' && choices.length >= 1 && choices.length <= 2) return choices;
    if (n.expects === 'choose' && choices.length === 2) return choices;
    return null;
  }
  const phoneReason = ask => ({ approve: '批准合并要看改动', reply: '要写一句', schedule: '要选时间', defer: '要选推到哪天', choose: '选项不止两个' })[normalizeAsk(ask).expects] || '要在手机上答';
  const recordOf = item => store.forItem(item, s.cursor);
  const answered = item => { const r = recordOf(item); return r && r.meaning !== 'snooze' ? r : null; };
  const snoozed = item => { const r = recordOf(item); return r?.meaning === 'snooze' && r.until > s.cursor; };
  function compose() {
    const all = kit.asks(s).filter(x => !snoozed(x.item)).sort(byUrgency);
    const urgent = all.filter(isUrgent), later = all.filter(x => !isUrgent(x));
    const waiting = urgent.filter(x => !answered(x.item));
    return { all, urgent, later, waiting };
  }
  function dueWords(item, ask) {
    const due = dueOf(item, ask);
    if (due == null) return (WEIGHT_RANK[item.weight] ?? 2) <= 1 ? { text: item.weight === 'critical' ? '档位关键' : '档位高', hot: false } : null;
    const ms = due - s.cursor;
    return ms < 0 ? { text: `已过 ${span(ms)}`, hot: true } : { text: `${formatTime(due)} 前 · 还有 ${span(ms)}`, hot: ms < DAY };
  }
  // One view of the face: what every tick shows, the number and what it is about. Built from the snapshot `s`.
  function build() {
    const v = compose(), root = id => kit.rootOf(s.state, id);
    const level = new Map();
    for (const x of v.all) { const r = root(x.item.id), l = isUrgent(x) ? (answered(x.item) ? 'done' : 'hot') : 'ask'; if (level.get(r) !== 'hot') level.set(r, l); }
    const marks = [];
    for (const item of s.state.root.items) for (let n = 0; n < item.share && marks.length < 64; n += 1) marks.push({ owner: item.id, level: level.get(item.id) || 'item', first: n === 0 });
    while (marks.length < 64) marks.push({ owner: null, level: 'blank', first: false });
    const top = v.waiting[0] || null;
    return {
      v, marks, level, root, top, topRoot: top ? root(top.item.id) : null, index: s.index, time: formatTime(s.cursor), day: formatDate(s.cursor),
      items: s.state.root.items.map(item => ({ id: item.id, share: item.share, short: shortOf(item.id) })), used: s.state.root.used,
      urgent: new Set(v.urgent.map(x => x.ask.id)), waiting: new Set(v.waiting.map(x => x.ask.id)), open: new Set(v.all.map(x => x.ask.id)),
    };
  }

  // ---------- stack ----------
  function cardHTML(x, at, total) {
    if (!x) return '';
    const { item, ask } = x, d = dueWords(item, ask), r = answered(item), wrist = wristChoices(ask);
    return `<div class="w-card${r ? ' is-done' : ''}" data-item="${esc(item.id)}">
      <div class="w-card-top">${d ? `<span class="w-due${d.hot ? ' is-hot' : ''}">${esc(d.text)}</span>` : '<span></span>'}<span class="w-pos">${at + 1}/${total}</span></div>
      <strong>${esc(shortAsk(ask, item))}</strong>
      <em>${esc(item.title)}</em>
      <small class="w-where ${wrist ? 'is-wrist' : 'is-phone'}">${r ? `✓ ${esc(r.label)} · 已${responseStatus(r, s.frames, s.cursor).status === 'acknowledged' ? '收到' : '保存'}` : wrist ? '表上可答 →' : `到手机上答 · ${esc(phoneReason(ask))}`}</small>
      ${r ? '<span class="w-stamp" aria-hidden="true">✓</span>' : ''}</div>`;
  }
  function stackHTML(v) {
    const head = `<div class="w-top"><span>${formatDate(s.cursor)}</span><span>${formatTime(s.cursor)}</span></div>`;
    if (!v.urgent.length) {
      return `${head}<div class="w-card is-calm"><div class="w-card-top"><span class="w-due is-calm">不用掏手机</span><span></span></div><strong>${v.later.length ? `${v.later.length} 个问题可以晚点` : '没有开着的问题'}</strong><em>${v.later.length ? '都不急：没有 24 小时内到期、也没有高档位的问题' : '状态里的事都只需知道'}</em><small class="w-where">回到手机上再看</small></div>`;
    }
    const n = v.urgent.length, at = ((front % n) + n) % n;
    const rest = n - 1;
    return `${head}<div class="w-deck">${cardHTML(v.urgent[at], at, n)}${rest > 0 ? '<div class="w-peek"></div>' : ''}${rest > 1 ? '<div class="w-peek is-2"></div>' : ''}</div>
      <div class="w-more">${v.later.length ? `另有 ${v.later.length} 个可以晚点` : rest ? `还有 ${rest} 张` : '只有这一张'}</div>`;
  }

  // ---------- reply ----------
  function replyHTML(v) {
    if (!v.urgent.length) return `<div class="w-calm"><div class="w-ok" aria-hidden="true">✓</div><p>此刻没有要紧的事</p><small>${v.later.length ? `${v.later.length} 个问题都可以晚点在手机上看` : '没有开着的问题'}</small></div>`;
    const n = v.urgent.length, { item, ask } = v.urgent[((front % n) + n) % n];
    const r = answered(item);
    if (r) {
      const { status, at } = responseStatus(r, s.frames, s.cursor);
      return `<div class="w-done is-${status}"><svg class="w-tick" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27l7 7 15-16"/></svg><p>你选了「${esc(r.label)}」</p><small>${status === 'acknowledged' ? `已收到 · Agent 在 ${formatTime(at)} 的整理中读到` : '已保存 · 等 Agent 下一轮整理'}</small><button type="button" class="w-undo" data-w="undo" data-item="${esc(item.id)}">撤回</button></div>`;
    }
    const wrist = wristChoices(ask), d = dueWords(item, ask);
    const head = `${d ? `<p class="w-reply-due${d.hot ? ' is-hot' : ''}">${esc(d.text)}</p>` : ''}<p class="w-prompt">${esc(shortAsk(ask, item))}</p>`;
    if (!wrist) {
      return `${head}<div class="w-phone"><span class="w-phone-icon" aria-hidden="true">▯</span><p>这件在手机上答</p><small>${esc(phoneReason(ask))}</small></div>
        <div class="w-actions"><button type="button" class="is-handoff" data-w="handoff" data-item="${esc(item.id)}">在手机上打开</button><button type="button" class="is-quiet" data-w="snooze" data-item="${esc(item.id)}">1 小时后再提醒</button></div>`;
    }
    return `${head}<div class="w-actions">${wrist.map((a, i) => `<button type="button" class="${a.recommended || (wrist.length === 1) ? 'is-rec' : i === 0 && !wrist.some(b => b.recommended) ? 'is-rec' : ''}" data-w="act" data-item="${esc(item.id)}" data-act="${esc(a.id)}">${esc(a.label)}</button>`).join('')}<button type="button" class="is-quiet" data-w="snooze" data-item="${esc(item.id)}">1 小时后再提醒</button></div>`;
  }

  // ---------- writing a view into the page ----------
  let shown = null;          // the view the face settles on (a running turn's target)
  let tr = null;             // the running turn
  let ledeText = '', ledeYes = false, ledeMode = '', version = 0;
  let geo = null, geoKey = '', dirty = true;
  function applyTime(view) {
    el.time.textContent = view.time;
    const top = $('.w-stack .w-top');
    if (top) { top.children[0].textContent = view.day; top.children[1].textContent = view.time; }
  }
  // Under the face: the four largest on the ring, the rest as one count, and the blank.
  function applyNames(view) {
    const head = view.items.slice(0, 4), rest = view.items.slice(4), blank = 64 - view.used;
    const restShare = rest.reduce((n, x) => n + x.share, 0);
    const tail = [rest.length ? `其余 ${rest.length} 件 ${restShare} 份` : '', blank ? `留白 ${blank} 份` : ''].filter(Boolean).join(' · ');
    names.innerHTML = (head.map(x => `<li data-id="${esc(x.id)}" class="is-${view.level.get(x.id) || 'item'}"><b>${x.share}</b><span>${esc(x.short)}</span></li>`).join('')
      + (tail ? `<li class="w-names-rest">${tail}</li>` : '')) || '<li class="w-names-rest">表圈还空着：留白 64 份</li>';
    version += 1; dirty = true;
  }
  function applyHaptic(n) {
    el.haptic.textContent = n == null ? '触感：换轮时，新变得要紧的问题有几件就轻敲几下'
      : n ? `触感：轻敲 ${n} 下 · 本轮新变得要紧 ${n} 件` : '触感：无 · 本轮没有新变得要紧的问题';
  }
  // The number, what it is about, the conclusion and the other two screens. `roll`: 'beat' (the turn rolls it),
  // 'animate' (an answer changed it: a short roll on the spot) or 'none'.
  function applyRest(view, { deck = 0, roll = 'none' } = {}) {
    const { v, top } = view, count = v.waiting.length, d = top && dueWords(top.item, top.ask);
    const before = el.n.textContent, fades = [];
    const set = (node, prop, value) => { if (node[prop] !== value) { node[prop] = value; fades.push(node); } };
    el.n.textContent = String(count);
    el.count.classList.toggle('is-zero', !count);
    set(el.unit, 'textContent', count ? '件要紧' : v.urgent.length ? '要紧的都答了' : '没有要紧的事');
    set(el.comp, 'innerHTML', top ? `${d ? `<em class="${d.hot ? 'is-hot' : ''}">${esc(d.text)}</em>` : ''}<span>${esc(shortAsk(top.ask, top.item))}</span>` : esc(v.later.length ? `${v.later.length} 个问题可以晚点` : '状态里没有开着的问题'));
    el.comp.classList.toggle('is-calm', !top);
    if (top) el.comp.dataset.id = view.topRoot; else delete el.comp.dataset.id;
    el.face.setAttribute('aria-label', count ? `${count} 件要紧，最急：${shortAsk(top.ask, top.item)}` : '没有要紧的事');
    const nextLede = count ? `要。${count} 件要紧，最急的是“${shortAsk(top.ask, top.item)}”。` : v.all.length ? `不用。${v.all.length} 个问题都可以晚点在手机上看。` : '不用。此刻没有开着的问题。';
    if (nextLede !== ledeText) fades.push(el.ledeA);
    ledeText = nextLede; ledeYes = Boolean(count); ledeMode = '';
    el.capFace.textContent = `表圈 64 格，一格一份，按排名顺时针点亮；亮朱红是要紧的问题，暗朱红是可以晚点的问题。中间的数只数要紧的：24 小时内到期或档位高。此刻开着 ${v.all.length} 个问题，${v.urgent.length} 件要紧。`;
    if (roll === 'beat' && tr) {
      tr.fade = fades;
      fades.forEach(node => { node.style.opacity = '0'; });
      if (before !== el.n.textContent && before !== '') { el.nOld.textContent = before; tr.roll = { down: count < Number(before) }; }
    } else if (roll === 'animate' && before !== el.n.textContent && before !== '' && !reduced()) {
      const down = count < Number(before);
      el.n.animate([{ transform: `translateY(${down ? 34 : -34}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: EASE });
    }
    screens(v, deck);
    meta(v);
    version += 1; dirty = true;
  }
  function screens(v, deck) {
    const stack = $('.w-stack'), reply = $('.w-reply');
    const oldCard = stack.querySelector('.w-card');
    const oldId = oldCard?.dataset.item, oldHTML = oldCard?.outerHTML;
    stack.innerHTML = stackHTML(v);
    const card = stack.querySelector('.w-card');
    const focusInReply = reply.contains(document.activeElement) ? document.activeElement.dataset.w : null;
    const before = reply.innerHTML;
    reply.innerHTML = replyHTML(v);
    if (focusInReply) (reply.querySelector(`[data-w="${focusInReply}"]`) || reply.querySelector('button'))?.focus({ preventScroll: true });
    if (!reduced() && card) {
      if (deck && oldId && oldId !== card.dataset.item) {
        // Turning the crown: the old card leaves upward, the next rises from the peek.
        const ghost = document.createElement('div');
        ghost.innerHTML = oldHTML;
        const g = ghost.firstElementChild;
        g.classList.add('w-card-ghost');
        stack.querySelector('.w-deck').append(g);
        g.animate([{ transform: 'none', opacity: 1 }, { transform: `translateY(${deck > 0 ? -34 : 34}px) scale(.94)`, opacity: 0 }], { duration: 260, easing: EASE }).onfinish = () => g.remove();
        card.animate([{ transform: `translateY(${deck > 0 ? 22 : -22}px) scale(.95)`, opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: EASE });
      } else if (oldId && oldId !== card.dataset.item) card.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: EASE });
      else if (oldHTML && oldHTML !== card.outerHTML) card.querySelectorAll('.w-where, .w-due, .w-stamp').forEach(node => node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 }));
    }
    if (!reduced() && before !== reply.innerHTML) {
      const done = reply.querySelector('.w-done');
      if (done && !before.includes('w-done')) {
        done.querySelector('.w-tick')?.classList.add('is-drawing');
        done.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE });
      } else reply.firstElementChild?.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE });
    }
  }
  function renderKeys() {
    $('.w-keys-t').textContent = tour ? '正在讲一遍：换到这一轮走完三拍，再看最急的那一件 · 按任意键跳过'
      : playing ? '▶ 播放中，每 5.6 秒一轮整理 · 空格暂停 · 悬停表圈停住' : '← → 换整理时刻 · 空格 播放 · 悬停表圈看概要、点击展开 · ↑ ↓ 翻张 · Enter 到按钮、再按作答';
    $('.w-keys').classList.toggle('is-playing', playing || Boolean(tour));
  }
  function meta(v) {
    renderKeys();
    $('.w-next').hidden = v.urgent.length < 2;
    $('.w-crown').disabled = v.urgent.length < 2;
    $('.w-cap-stack').textContent = v.urgent.length ? `只叠要紧的 ${v.urgent.length} 件，最急的在最前${v.later.length ? `；其余 ${v.later.length} 个问题只记一个数，留给手机` : ''}。` : `没有要紧的问题。${v.later.length ? `${v.later.length} 个问题都可以晚点。` : ''}`;
    renderSide(v);
  }
  function renderSide(v) {
    const items = [...s.state.root.items];
    const hot = new Set(v.urgent.map(x => kit.rootOf(s.state, x.item.id))), asked = new Set(v.all.map(x => kit.rootOf(s.state, x.item.id)));
    const shownItems = items.filter((item, i) => i < 8 || hot.has(item.id));
    const hidden = items.filter(item => !shownItems.includes(item));
    kit.side.innerHTML = `<h3 class="w-legend-title">要紧的问题（表盘上的数）</h3>
      <ol class="w-legend is-asks">${v.urgent.map(({ item, ask }) => `<li><span class="is-hot">${chars(shortAsk(ask, item)).length}</span>${esc(shortAsk(ask, item))}<small>${esc(item.title)}</small></li>`).join('') || '<li><span>0</span>此刻没有</li>'}</ol>
      <p class="w-legend-note">规则：24 小时内到期（含已过期）或档位 critical / high。左边数字是短问法的字数（≤16）。可以晚点的 ${v.later.length} 个问题不上表盘。</p>
      <h3 class="w-legend-title">表圈刻度，顺时针</h3>
      <ol class="w-legend">${shownItems.map(i => `<li><span class="${hot.has(i.id) ? 'is-hot' : asked.has(i.id) ? 'is-ask' : ''}">${i.share}</span>${esc(i.title)}</li>`).join('')}${hidden.length ? `<li><span class="is-blank">${hidden.reduce((n, i) => n + i.share, 0)}</span>其余 ${hidden.length} 件</li>` : ''}${s.state.root.used < 64 ? `<li><span class="is-blank">${64 - s.state.root.used}</span>未分配</li>` : ''}</ol>`;
  }

  // ---------- the turn ----------
  function startTurn() {
    if (tr) finishTurn();
    const from = shown, to = build();
    // New since the face last settled: urgent now, not urgent then. They flash and tap; with none new, the most
    // urgent one still waiting glows gently; with nothing waiting, nothing flashes.
    const fresh = to.v.waiting.filter(x => !from.urgent.has(x.ask.id));
    const flash = new Set(fresh.length ? fresh.map(x => to.root(x.item.id)) : to.topRoot ? [to.topRoot] : []);
    // Grains: one for every two inputs of the round, at most 120; an empty round has none.
    const events = s.frame.events, n = Math.min(120, Math.ceil(events.length / 2));
    el.grains.innerHTML = '<circle r="1.5" opacity="0"/>'.repeat(n);
    const grains = [...el.grains.children].map((node, j) => {
      const id = events[j * 2]?.id ?? `${s.index}:${j}`;
      return { node, a: hash(`${id}:a`) * TAU, delay: hash(`${id}:d`) * 0.28, r0: 148 + hash(`${id}:r`) * 34 };
    });
    shown = to;
    tr = { T: 0, from, to, fresh: fresh.length, flash, strong: fresh.length > 0, grains, done: { names: false, haptic: false, rest: false }, fade: [], roll: null };
    applyTime(to);
    refreshPresent();
    version += 1;
    if (reduced()) finishTurn();
  }
  function stepTurn() {
    const T = tr.T;
    if (T >= BEAT.swept && !tr.done.names) { tr.done.names = true; applyNames(tr.to); }
    if (T >= BEAT.flash && !tr.done.haptic) { tr.done.haptic = true; applyHaptic(tr.fresh); }
    if (T >= BEAT.settle && !tr.done.rest) { tr.done.rest = true; applyRest(tr.to, { roll: 'beat' }); }
    if (T >= BEAT.end) finishTurn();
  }
  function finishTurn() {
    const t = tr;
    if (!t) return;
    tr = null;
    if (!t.done.names) applyNames(t.to);
    if (!t.done.haptic) applyHaptic(t.fresh);
    if (!t.done.rest) applyRest(t.to, { roll: 'none' });
    el.grains.replaceChildren();
    el.glow.forEach(p => p.setAttribute('d', ''));
    el.nOld.textContent = '';
    for (const node of [el.n, el.nOld, ...t.fade]) { node.style.opacity = ''; node.style.transform = ''; }
    el.pulse.style.opacity = '0';
    refreshPresent();
    version += 1;
  }
  // The concept layer and the beats' own motion: grains, the sweep, the taps, the roll and the fades.
  function paintTurn() {
    const T = tr.T;
    for (const g of tr.grains) {
      const u = (T - g.delay) / 0.22;
      if (u <= 0 || u >= 1) { g.node.setAttribute('opacity', '0'); continue; }
      const r = lerp(g.r0, R1 + 3, u * u);
      g.node.setAttribute('cx', (Math.cos(g.a) * r).toFixed(1));
      g.node.setAttribute('cy', (Math.sin(g.a) * r).toFixed(1));
      g.node.setAttribute('opacity', (0.7 * Math.min(1, u * 5) * (u > 0.8 ? (1 - u) / 0.2 : 1)).toFixed(3));
    }
    const f = clamp((T - BEAT.sweep) / (BEAT.swept - BEAT.sweep)), fade = T < BEAT.sweep ? 0 : 1 - clamp((T - BEAT.swept) / 0.12);
    const head = -Math.PI / 2 + f * TAU;
    el.glow.forEach((p, j) => {
      const a1 = head - j * 0.12, a0 = Math.max(-Math.PI / 2, head - (j + 1) * 0.12);
      if (fade <= 0 || a1 - a0 < 0.005) { p.setAttribute('d', ''); return; }
      p.setAttribute('d', arcD(0, 0, RM, a0, a1));
      p.setAttribute('opacity', ([0.16, 0.1, 0.06, 0.03][j] * fade).toFixed(3));
    });
    let h = 0;
    for (let j = 0; j < tr.fresh; j += 1) {
      const w = (BEAT.flashed - BEAT.flash - 0.04) / tr.fresh, t0 = BEAT.flash + 0.02 + j * w;
      h = Math.max(h, bump(T, t0, t0 + w * 0.3, t0 + w * 0.45, t0 + w * 0.95));
    }
    el.pulse.style.opacity = h.toFixed(3);
    el.pulse.style.transform = `scale(${lerp(0.97, 1, h).toFixed(4)})`;
    if (tr.roll) {
      const k = easeOut((T - BEAT.settle) / (BEAT.end - BEAT.settle)), dir = tr.roll.down ? 1 : -1;
      el.n.style.transform = `translateY(${(dir * (1 - k) * 100).toFixed(1)}%)`; el.n.style.opacity = k.toFixed(3);
      el.nOld.style.transform = `translate(-50%, ${(-dir * k * 100).toFixed(1)}%)`; el.nOld.style.opacity = (1 - k).toFixed(3);
    }
    const q = clamp((T - BEAT.settle) / 0.3).toFixed(3);
    for (const node of tr.fade) node.style.opacity = q;
  }

  // ---------- the ring, drawn every frame something on it moves ----------
  const shownMarks = [];
  const written = ticks.map(() => ({}));
  const write = (k, prop, value) => { if (written[k][prop] !== value) { written[k][prop] = value; ticks[k].style[prop] = value; } };
  function paintRing() {
    const T = tr ? tr.T : BEAT.end, to = shown.marks, from = tr?.from.marks;
    let lit = 0, rest = 1;
    if (tr && tr.flash.size) {
      const f = bump(T, BEAT.flash, BEAT.flash + 0.08, BEAT.flash + 0.2, BEAT.flashed);
      if (tr.strong) { lit = f; rest = 1 - 0.65 * bump(T, BEAT.flash, BEAT.flash + 0.06, BEAT.flashed - 0.1, BEAT.flashed); } else lit = 0.4 * f;
    }
    const dimK = 1 - 0.3 * X.dim, popping = X.popId && X.pop > 0.001;
    for (let k = 0; k < 64; k += 1) {
      const m = from && T < BEAT.sweep + (BEAT.swept - BEAT.sweep) * (k + 0.5) / 64 ? from[k] : to[k];
      shownMarks[k] = m;
      const [stroke, width, base] = LOOK[m.level];
      let o = m.level === 'item' && m.first ? 0.95 : base, w = width, c = stroke;
      if (lit > 0 && m === to[k] && tr.flash.has(m.owner)) { w = width + 2.2 * lit; c = mix(stroke, FLASH, lit); o = Math.min(1, o + 0.5 * lit); } else o *= rest;
      if (X.focus && m.owner !== X.focus) o *= dimK;
      if (popping && m.owner === X.popId) o = 0;
      if (ticks[k].getAttribute('class') !== `is-${m.level}`) ticks[k].setAttribute('class', `is-${m.level}`);
      write(k, 'stroke', c); write(k, 'strokeWidth', String(w)); write(k, 'opacity', o.toFixed(3));
    }
  }
  function paintNames() {
    const f = X.focus, k = (1 - 0.3 * X.dim).toFixed(3);
    for (const li of names.children) {
      const id = li.dataset.id;
      li.style.opacity = f && id !== f ? k : '';
      li.classList.toggle('is-key', Boolean(id && X.keyFocus === id));
    }
  }
  // Opening an item cuts the conclusion to “这一件”.
  function paintLede() {
    const f = X.detail ? ix.view : null, mode = f ? `cut:${f.i}:${f.id}` : `n:${ledeText}:${ledeYes}`;
    if (mode === ledeMode) return;
    ledeMode = mode;
    if (f) {
      const seen = ix.s.seen || ALL, share = seen.share ? f.share : f.before;
      el.ledeQ.textContent = `这一件 · 第 ${f.i} 轮`;
      el.ledeA.textContent = `${f.short} ${share} / 64 份${seen.share && f.change ? ` · ${f.change.text}` : ''}`;
    } else { el.ledeQ.textContent = '要不要现在掏手机？'; el.ledeA.textContent = ledeText; }
    lede.classList.toggle('is-cut', Boolean(f));
    lede.classList.toggle('is-yes', !f && ledeYes);
  }

  // ---------- geometry: the face in the wrap's px ----------
  function measure() {
    dirty = false;
    const w = wrap.getBoundingClientRect(), r = ring.getBoundingClientRect(), c = caseEl.getBoundingClientRect(), l = lede.getBoundingClientRect();
    const next = {
      cx: r.left - w.left + r.width / 2, cy: r.top - w.top + r.height / 2, sc: r.width / 260,
      case: { x0: c.left - w.left, y0: c.top - w.top, x1: c.right - w.left, y1: c.bottom - w.top },
      // The conclusion as a full-width band, so its own length never moves a card.
      lede: { x0: 0, y0: l.top - w.top, x1: w.width, y1: l.bottom - w.top },
    };
    const key = JSON.stringify(next);
    if (key !== geoKey) { geoKey = key; geo = next; ix.relayout(); version += 1; }
  }
  new ResizeObserver(() => { dirty = true; }).observe(wrap);
  stage.addEventListener('scroll', () => ix.relayout(), { passive: true });
  const gutter = () => ({ x0: geo.case.x0 - 9, y0: geo.case.y0 - 9, x1: geo.case.x1 + 9, y1: geo.case.y1 + 9 });
  function segOf(id) {
    let k0 = -1, k1 = -1;
    for (const list of [shownMarks.length ? shownMarks : shown.marks, shown.marks]) {
      list.forEach((m, k) => { if (m.owner === id) { if (k0 < 0) k0 = k; k1 = k; } });
      if (k0 >= 0) break;
    }
    return k0 < 0 ? null : { k0, k1, a: ((k0 + k1 + 1) / 2 / 64) * TAU - Math.PI / 2 };
  }
  const at = (a, r) => ({ x: geo.cx + Math.cos(a) * r, y: geo.cy + Math.sin(a) * r });
  function tickAt(x, y) {
    if (!geo) return null;
    const dx = x - geo.cx, dy = y - geo.cy, r = Math.hypot(dx, dy);
    if (r < HIT_IN * geo.sc || r > R1 * geo.sc + HIT_OUT) return null;
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    if (a < 0) a += TAU;
    const m = (shownMarks.length ? shownMarks : shown.marks)[Math.min(63, Math.floor((a / TAU) * 64))];
    return m?.owner && present.has(m.owner) ? m.owner : null;
  }
  // Cards stay in the part of the page that is on screen (the stage scrolls when the window is short).
  const bounds = () => {
    const w = wrap.getBoundingClientRect(), v = stage.getBoundingClientRect();
    return { x0: Math.max(0, v.left - w.left) + 8, y0: Math.max(0, v.top - w.top) + 8, x1: Math.min(w.width, v.right - w.left) - 8, y1: Math.min(w.height, v.bottom - w.top) - 8 };
  };
  // Cards hang outside the case on the side with room (the right, over the other two screens, on this page).
  const sideFor = () => { const B = bounds(), right = B.x1 - geo.case.x1, left = geo.case.x0 - B.x0; return right >= 338 || right >= left ? 1 : -1; };
  // Where the ray of angle a leaves the gutter round the case, and at what height a leader from it reaches the card's side.
  function exitOf(a, side) {
    const G = gutter(), c = Math.cos(a), sn = Math.sin(a);
    const t = Math.min(c > 1e-6 ? (G.x1 - geo.cx) / c : c < -1e-6 ? (G.x0 - geo.cx) / c : Infinity, sn > 1e-6 ? (G.y1 - geo.cy) / sn : sn < -1e-6 ? (G.y0 - geo.cy) / sn : Infinity);
    const p = { x: geo.cx + c * t, y: geo.cy + sn * t }, near = side > 0 ? G.x1 : G.x0, far = side > 0 ? G.x0 : G.x1;
    const onNear = Math.abs(p.x - near) < 0.5, onFar = Math.abs(p.x - far) < 0.5;
    return { p, near, far, onNear, onFar, y: onNear ? p.y : p.y < geo.cy ? G.y0 : G.y1 };
  }
  // The leader: out along the segment's own radius past the case, round the case's top or bottom if it has to,
  // then level into the card's facing edge. Never over the face.
  function route(id, card, r0) {
    const seg = segOf(id), a = seg ? seg.a : -Math.PI / 2, G = gutter();
    const side = card.x0 >= G.x1 - 0.5 ? 1 : card.x1 <= G.x0 + 0.5 ? -1 : 0;
    const e = exitOf(a, side || 1), pts = [at(a, r0), e.p];
    if (!side) { pts.push(edgePoint(e.p, card)); return pts; }
    if (!e.onNear) {
      if (e.onFar) pts.push({ x: e.far, y: e.y });
      pts.push({ x: e.near, y: e.y });
    }
    const ex = side > 0 ? card.x0 : card.x1, ey = clamp(e.y, card.y0 + 6, card.y1 - 6);
    if (Math.abs(ey - e.y) > 0.5) pts.push({ x: e.near, y: ey });
    pts.push({ x: ex, y: ey });
    return pts;
  }
  const peekRoutes = new Map();
  function peekPlace(id, w, h) {
    const seg = segOf(id), side = sideFor(), e = exitOf(seg ? seg.a : -Math.PI / 2, side);
    const anchor = { x: e.near, y: e.y };
    const p = placeBeside({ at: anchor, from: anchor, facing: side, w, h, bounds: bounds(), gap: 9, flush: true, avoid: [geo.case, geo.lede], pad: 6 });
    peekRoutes.set(id, route(id, { x0: p.x, y0: p.y, x1: p.x + w, y1: p.y + h }, R1 * geo.sc + 1));
    return p;
  }
  function detailPlace(id, node) {
    const seg = segOf(id), side = sideFor(), e = exitOf(seg ? seg.a : -Math.PI / 2, side);
    return placeColumn({ el: node, facing: side, width: 320, minWidth: 250, bounds: bounds(), words: [geo.lede], keep: geo.case, anchorY: e.y, hug: 'keep', gapX: 18,
      leader: card => route(id, card, R1 * geo.sc + IX.pop + 1) });
  }
  function pointOf(id) {
    const seg = segOf(id);
    if (seg && geo) return at(seg.a, RM * geo.sc);
    const li = names.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!li) return null;
    const w = wrap.getBoundingClientRect(), b = li.getBoundingClientRect();
    return { x: b.left - w.left + b.width / 2, y: b.top - w.top + b.height / 2 };
  }

  // ---------- interaction (motion/ix.mjs) ----------
  let present = new Set();
  function refreshPresent() { present = new Set([...(tr ? tr.from.marks : []), ...shown.marks].map(m => m.owner).concat(shown.topRoot).filter(Boolean)); }
  let held = false, playing = false, playT = 0, pin = null, advancing = false, tour = null;
  const ix = createIx({
    stage: wrap, keysIn: $('.w-fig-face'),
    facts: id => itemFacts(s.index, id), has: id => present.has(id), hit: tickAt, pointOf, index: () => s.index,
    named: name => (present.has(name) ? name : [...present].find(id => shortOf(id) === name) || null),
    pause: () => { held = true; }, resume: () => { held = false; }, paused: () => held,
    last, answerHref: f => withDataset(`../index.html?variant=d&frame=${f.i}`),
    // Stopped in the middle of a turn, the cards say only what the beats so far have shown.
    seen: () => (tr ? { inputs: tr.T >= BEAT.grains, share: tr.T >= BEAT.swept, asks: tr.T >= BEAT.flash } : ALL),
    asks: (f, seen) => {
      const view = seen.asks || !tr ? shown : tr.from;
      return f.asks.filter(a => view.open.has(a.id)).map(a => ({ ...a, cursor: view.waiting.has(a.id) }));
    },
    peekPlace, detailPlace, leaders: 'host', trendH: 32, pending: '本轮的输入还在落向表圈',
    label: '表圈上的事项：Tab 逐个看概要，Enter 展开详情，Esc 收回',
  });
  let X = ix.X;
  let overDrawn = false;
  function paintOver() {
    const id = X.popId, k = X.pop;
    if (id && k > 0.001 && geo) {
      const list = [];
      shownMarks.forEach((m, i) => { if (m.owner === id) list.push([m, i]); });
      if (el.pop.dataset.id !== id || el.pop.childElementCount !== list.length) { el.pop.dataset.id = id; el.pop.innerHTML = '<line/>'.repeat(list.length); }
      list.forEach(([m, i], j) => {
        const line = el.pop.children[j], a = angleOf(i), out = IX.pop * k, p0 = at(a, R0 * geo.sc + out), p1 = at(a, R1 * geo.sc + out);
        const [stroke, width, base] = LOOK[m.level];
        line.setAttribute('x1', p0.x.toFixed(1)); line.setAttribute('y1', p0.y.toFixed(1)); line.setAttribute('x2', p1.x.toFixed(1)); line.setAttribute('y2', p1.y.toFixed(1));
        line.style.stroke = stroke; line.style.strokeWidth = String(width * geo.sc); line.style.opacity = String(m.level === 'item' && m.first ? 0.95 : base);
      });
    } else if (el.pop.childElementCount) { el.pop.replaceChildren(); delete el.pop.dataset.id; }
    const seg = X.keyFocus && geo && segOf(X.keyFocus);
    el.focus.setAttribute('d', seg ? arcD(geo.cx, geo.cy, R1 * geo.sc + 6, angleOf(seg.k0) - 0.03, angleOf(seg.k1) + 0.03) : '');
    const L = ix.leaders(), xd = L.detail ? pathD(L.detail.points) : '';
    for (const p of [el.xline, el.xhalo]) {
      if (p.getAttribute('d') !== xd) p.setAttribute('d', xd);
      p.style.strokeDashoffset = L.detail ? (1 - L.detail.progress).toFixed(4) : '1';
    }
    const pr = L.peek && peekRoutes.get(X.peekId), pd = pr ? pathD(pr) : '';
    for (const p of [el.pline, el.phalo]) {
      if (p.getAttribute('d') !== pd) p.setAttribute('d', pd);
      p.style.opacity = L.peek ? L.peek.alpha.toFixed(3) : '0';
    }
    overDrawn = Boolean(xd || pd || seg || el.pop.childElementCount);
  }

  // ---------- the clock: turns and play run only while nothing holds them ----------
  function setPlaying(on) { playing = on; playT = 0; renderKeys(); }
  function togglePlay() {
    if (playing) { setPlaying(false); return; }
    if (s.index >= last) { advancing = true; model.goFrame(0); advancing = false; }
    setPlaying(true);
  }
  function advance() {
    if (s.index >= last) { setPlaying(false); return; }
    advancing = true; model.goFrame(s.index + 1); advancing = false;
    if (s.index >= last) setPlaying(false);
  }
  let lastNow = 0, sig = '';
  function loop(now) {
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    lastNow = now;
    if (dirty) measure();
    X = ix.frame();
    if (tr) {
      if (pin != null) tr.T = Math.min(BEAT.end, pin); else if (!held) tr.T += dt;
      stepTurn();
    }
    if (playing && !held) { playT += dt; if (playT >= PLAY) { playT = 0; advance(); } }
    const key = `${tr ? tr.T.toFixed(3) : '-'}|${X.focus}|${X.dim.toFixed(3)}|${X.popId}|${X.pop > 0.001}|${X.keyFocus}|${version}`;
    if (key !== sig) { sig = key; paintRing(); paintNames(); }
    if (tr) paintTurn();
    paintLede();
    ix.paint();
    if (ix.live() || overDrawn) paintOver();
    ix.sync(s.index, () => shown.items.map(x => ({ id: x.id, label: `${x.short} ${x.share} 份${shown.level.get(x.id) === 'hot' ? ' · 等你回' : ''}` })));
    requestAnimationFrame(loop);
  }

  // ---------- render outside a turn: answering, undoing, snoozing, turning the crown ----------
  function render({ deck = 0 } = {}) {
    s = model.snapshot();
    if (tr) finishTurn();
    const first = !shown;
    shown = build();
    applyTime(shown); applyNames(shown);
    applyRest(shown, { deck, roll: first ? 'none' : 'animate' });
    refreshPresent();
  }
  function turn(step) {
    const v = compose();
    if (v.urgent.length < 2) return;
    front += step;
    render({ deck: step });
  }

  stage.addEventListener('click', event => {
    const b = event.target.closest('[data-w]');
    if (!b) return;
    const kind = b.dataset.w;
    if (kind === 'crown') { turn(1); return; }
    if (kind === 'replay') { startTour(); return; }
    const item = kit.getItem(s.state, b.dataset.item);
    if (!item) return;
    const ask = kit.currentAsk(s, item.id);
    if (kind === 'undo') { store.remove(item); kit.toast('已撤回'); render(); return; }
    if (kind === 'handoff') { kit.toast('本页演示：手机上会直接打开这张卡'); return; }
    if (kind === 'snooze') { store.save(item, { id: 'snooze', label: '稍后提醒', meaning: 'snooze' }, { ask, at: s.cursor, until: s.cursor + HOUR }); kit.toast(`${formatTime(s.cursor + HOUR)} 再提醒 · 本页演示`); render(); return; }
    if (kind === 'act') {
      const action = normalizeAsk(ask).actions.find(a => a.id === b.dataset.act);
      store.save(item, action, { ask, at: s.cursor });
      kit.toast('已保存 · 本页演示，不写回状态');
      render();
    }
  });
  const stackEl = $('.w-stack');
  stackEl.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); turn(1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); turn(-1); }
  });
  let wheelAt = 0;
  stackEl.addEventListener('wheel', event => { event.preventDefault(); const now = performance.now(); if (now - wheelAt < 280 || Math.abs(event.deltaY) < 4) return; wheelAt = now; turn(event.deltaY > 0 ? 1 : -1); }, { passive: false });
  const onKey = event => {
    if (event.target.matches('input, textarea, select, [contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === ' ' && !event.target.closest('button, a, summary')) { event.preventDefault(); togglePlay(); }
    // Nothing focused yet: Enter jumps to the reply screen's first button (focus only; a second Enter answers).
    if (event.key === 'Enter' && (event.target === document.body || event.target === document.documentElement)) { const first = $('.w-reply button'); if (first) { event.preventDefault(); first.focus(); } }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !stackEl.contains(event.target) && !event.target.closest('.fs-inspector')) { event.preventDefault(); turn(event.key === 'ArrowDown' ? 1 : -1); }
  };
  document.addEventListener('keydown', onKey);

  model.subscribe((next, info) => {
    s = next;
    if (info.type === 'init' || !shown) { render(); applyHaptic(null); lastIndex = next.index; return; }
    if (info.type === 'frame' && next.index !== lastIndex) {
      // Any navigation but play's own step stops play; every one drops hover and detail and runs the three beats.
      if (!advancing && playing) setPlaying(false);
      front = 0;
      ix.reset();
      lastIndex = next.index;
      startTurn();
      return;
    }
    render();
  });

  window.foldWatch = {
    ...ix.hooks(),
    get index() { return s.index; },
    go: i => model.goFrame(i),
    // Pin the turn at t seconds from the cut (stills, checks); null lets it run.
    beatAt: t => { pin = t == null ? null : Number(t); },
    beat: () => (tr ? tr.T : null),
    play: () => { if (!playing) togglePlay(); },
    stop: () => setPlaying(false),
    playing: () => playing,
    // The ring as it settles: one entry per root item, its ticks and middle angle (radians, 0 = 3 o'clock).
    ring: () => shown.items.map(x => ({ id: x.id, short: x.short, share: x.share, level: shown.level.get(x.id) || 'item', ...segOf(x.id) })),
    geom: () => { const w = wrap.getBoundingClientRect(); return { cx: w.left + geo.cx, cy: w.top + geo.cy, inner: R0 * geo.sc, outer: R1 * geo.sc, band: R1 * geo.sc + HIT_OUT }; },
  };

  // ---------- 自动讲一遍 ----------
  // Only when this page is the top window, was opened directly (no referrer) and its address had no ?frame= (the shell
  // fills one in before this module runs, so read the address the page was loaded with).
  const topLevel = (() => { try { return window.top === window; } catch { return false; } })();
  const loadedWith = new URL(performance.getEntriesByType?.('navigation')?.[0]?.name || location.href);
  const direct = topLevel && !document.referrer && !loadedWith.searchParams.has('frame');
  // The sample turn is the share dial's third beat (composite f25 → f26, story f14 → f15).
  const sample = Math.max(1, Math.min(last, hero.b3));
  function jump(i) { advancing = true; model.goFrame(i); advancing = false; if (tr) finishTurn(); }
  function startTour() {
    stopTour();
    if (playing) setPlaying(false);
    ix.reset();
    jump(sample - 1);
    const steps = [
      [900, () => { advancing = true; model.goFrame(sample); advancing = false; }],
      [900 + BEAT.end * 1000 + 700, () => { const id = shown.topRoot || shown.items[0]?.id; if (id && !ix.s.hover && !ix.s.open) ix.hover(id, 'tour'); }],
      [900 + BEAT.end * 1000 + 3000, () => stopTour()],
    ];
    tour = { timers: steps.map(([ms, fn]) => setTimeout(fn, ms)) };
    renderKeys();
  }
  function stopTour(skip = false) {
    if (!tour) return;
    tour.timers.forEach(clearTimeout);
    tour = null;
    if (ix.s.via === 'tour') ix.hover(null, 'now');
    if (skip) { if (s.index !== sample) jump(sample); else if (tr) finishTurn(); }
    renderKeys();
  }
  // Any key skips (and is spent on skipping); so does a press anywhere, which then goes on as usual.
  window.addEventListener('keydown', event => { if (!tour) return; event.preventDefault(); event.stopImmediatePropagation(); stopTour(true); }, true);
  window.addEventListener('pointerdown', event => { if (tour && !event.target.closest?.('[data-w="replay"]')) stopTour(true); }, true);
  $('.w-replay').hidden = !topLevel;
  if (direct && !reduced()) startTour();
  requestAnimationFrame(loop);
}
