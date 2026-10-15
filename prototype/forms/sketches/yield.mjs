// 04 让位图（完整版）：每一行是一次整理。中线左边是这一轮让出份额的事项（以及被动用的留白），
// 右边是拿到份额的事项（以及退回的留白）。根层永远 64 份，所以每行左右一样长。
// 颜色只表示事项身份；虚线框是留白；1–3 份的小额合成“其余 N 件”，可展开。
// 帧导航：行随帧落下，新行从左翼外端扫到中线、再从中线扫到右翼外端，方向就是份额的去向。
import {
  createStage, esc, frames, records, dayTime, formatTime, colorOf, shortOf, titleAt, responsesIn,
  askById, itemDetailHTML, kindWord, reduced, foldSentences,
} from './stage.mjs';
import { dayOf, weekdayOf, at, textWidth, personName } from './kit.mjs';

const SMALL = 3;
const key = `
  <span><i class="sw" style="background:#2f7f6f"></i><i class="sw" style="background:#b8643a"></i><i class="sw" style="background:#c49a2c"></i>颜色只表示事项身份</span>
  <span><svg width="22" height="12"><rect x="1" y="1" width="20" height="10" fill="none" stroke="var(--ink-3)" stroke-dasharray="2 2"/></svg>留白：被动用（左）或退回（右）</span>
  <span><svg width="26" height="12"><rect x="0.5" y="0.5" width="25" height="11" fill="var(--faint)" stroke="var(--line)"/><rect x="1" y="8" width="8" height="3" fill="#86569c"/><rect x="9" y="8" width="6" height="3" fill="#3a78b0"/><rect x="15" y="8" width="10" height="3" fill="#5b8c37"/></svg>其余 N 件：1–3 份的小额，点开逐件</span>
  <span><b class="y-key-ans">↩</b>这一轮你答了登记的问题，点开看份额让给了谁</span>
  <span>一格 = 1 份；每行左右等长，因为根层永远是 64 份</span>
  <span class="note"><kbd>←</kbd><kbd>→</kbd> 逐帧 <kbd>空格</kbd> 播放 <kbd>↑</kbd><kbd>↓</kbd> 换行 <kbd>Enter</kbd> 固定 <kbd>Esc</kbd> 取消</span>`;
const stage = createStage({
  id: 'yield', no: 4, name: '让位图', storyIndex: 17, key,
  relation: '每一轮份额从谁那里来、到谁那里去：一件事变大，必有别的事让位或动用留白，两边永远相等。',
  tools: `<div class="st-seg" role="group" aria-label="小额"><button type="button" data-y="fold" aria-pressed="true">合并小额</button><button type="button" data-y="unfold" aria-pressed="false">逐件</button></div>`,
});
const figure = stage.figure;

// ---------- data: what each round gave and took ----------
const shareMaps = frames.map((_, i) => new Map(records[i].state.root.items.map(item => [item.id, item.share])));
const freeAfter = i => 64 - records[i].state.root.used;
const rows = frames.map((frame, i) => {
  const before = i ? shareMaps[i - 1] : new Map(), after = shareMaps[i];
  const gave = [], took = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(id) || 0, a = after.get(id) || 0;
    if (a < b) gave.push({ id, n: b - a, before: b, after: a });
    if (a > b) took.push({ id, n: a - b, before: b, after: a });
  }
  const f0 = i ? freeAfter(i - 1) : 64, f1 = freeAfter(i);
  if (f1 < f0) gave.push({ id: 'free', n: f0 - f1, before: f0, after: f1 });
  if (f1 > f0) took.push({ id: 'free', n: f1 - f0, before: f0, after: f1 });
  const order = (a, b) => (a.id === 'free') - (b.id === 'free') || b.n - a.n || a.id.localeCompare(b.id);
  gave.sort(order); took.sort(order);
  const decl = frame.batch?.declarations || [];
  const tags = [];
  const added = decl.filter(d => !d.relation || d.relation === 'new').length;
  if (added) tags.push(`新增 ${added}`);
  const withdrawn = decl.filter(d => d.relation === 'withdraw').length;
  if (withdrawn) tags.push(`撤下 ${withdrawn}`);
  for (const d of decl.filter(x => x.relation?.startsWith('merges:'))) tags.push(`${d.relation.slice(7).replace(/[[\]\s"']/g, '').split(',').map(shortOf).join('与')}并为${shortOf(d.id)}`);
  if (records[i].receipt?.type === 'checked') tags.push('检查后不变');
  const answers = responsesIn(i).filter(r => r.link.ask);
  const asked = [...new Set(answers.map(a => a.link.ask))];
  return { i, gave, took, total: gave.reduce((s, g) => s + g.n, 0), free: f1, tags, answers, asked, annotations: frame.annotations || [] };
});
// Where each item appears: rows it gave in (left) and took in (right).
const appearances = new Map();
for (const r of rows) for (const [side, list] of [['l', r.gave], ['r', r.took]]) for (const s of list) {
  if (!appearances.has(s.id)) appearances.set(s.id, []);
  appearances.get(s.id).push({ i: r.i, side, ...s });
}
const totals = rows.map(r => r.total).sort((a, b) => b - a);
const CAP = Math.max(18, totals[1] || totals[0] || 18);
const scaled = rows.filter(r => r.total > CAP);

// ---------- layout ----------
let unfoldAll = false;
const openRest = new Set(), autoOpen = new Set();
let geo = null;
const restKey = (i, side) => `${i}:${side}`;
function measure() {
  const W = figure.clientWidth, H = figure.clientHeight;
  const WHEN = 86, RESP = 24, SPINE = 42, NOTE = Math.max(230, Math.min(300, W * 0.24)), HEAD = 30;
  const wing = Math.floor((W - WHEN - RESP - SPINE - NOTE - 14) / 2);
  const rowH = Math.max(15, Math.min(30, (H - HEAD - 4) / frames.length));
  const bar = Math.max(12, Math.min(17, rowH - 6));
  return { W, H, WHEN, RESP, SPINE, NOTE, HEAD, wing, rowH, unit: wing / CAP, bar, font: bar >= 14 ? 11 : 10 };
}
function label(text, n, width, light) {
  const fits = s => textWidth(s, geo.font, 600) + 9 <= width;
  let shown = [`${text} ${n}`, text].find(fits);
  // A name cut short still says which thing it is better than a bare number does.
  for (let k = [...text].length - 1; !shown && k >= 2; k -= 1) { const cut = `${[...text].slice(0, k).join('').trim()}…`; if (fits(cut)) shown = cut; }
  if (!shown && fits(String(n))) shown = String(n);
  return shown ? `<em class="${light ? 'is-light' : ''}">${esc(shown)}</em>` : '';
}
function segHTML(s, i, side, u) {
  const w = s.n * u;
  if (s.id === 'free') return `<span class="y-seg y-free" role="button" tabindex="0" data-item="free" data-i="${i}" data-side="${side}" style="width:${w.toFixed(2)}px;--u:${u.toFixed(3)}px">${label('留白', s.n, w, true)}</span>`;
  return `<span class="y-seg" role="button" tabindex="0" data-item="${esc(s.id)}" data-i="${i}" data-side="${side}" style="width:${w.toFixed(2)}px;--c:${colorOf(s.id)};--u:${u.toFixed(3)}px">${label(shortOf(s.id), s.n, w)}</span>`;
}
function wingHTML(list, i, side, u) {
  const named = [], small = [];
  let free = null;
  for (const s of list) { if (s.id === 'free') free = s; else if (s.n <= SMALL) small.push(s); else named.push(s); }
  if (small.length < 2) { named.push(...small); small.length = 0; named.sort((a, b) => b.n - a.n || a.id.localeCompare(b.id)); }
  let html = named.map(s => segHTML(s, i, side, u)).join('');
  if (small.length) {
    const n = small.reduce((sum, s) => sum + s.n, 0), w = n * u, k = restKey(i, side);
    const open = unfoldAll || openRest.has(k);
    const restLabel = textWidth(`其余 ${small.length} 件`, 10.5, 500) + 8 <= w ? `其余 ${small.length} 件` : textWidth(`+${small.length}`, 10.5, 500) + 6 <= w ? `+${small.length}` : '';
    html += `<span class="y-rest${open ? ' is-open' : ''}" role="button" tabindex="0" aria-expanded="${open}" data-rest="${k}" data-i="${i}" data-side="${side}" style="width:${w.toFixed(2)}px">
      <b>${restLabel}</b><span class="y-subs">${small.map(s => `<span class="y-sub" role="button" tabindex="${open ? 0 : -1}" data-item="${esc(s.id)}" data-i="${i}" data-side="${side}" style="width:${(s.n * u).toFixed(2)}px;--c:${colorOf(s.id)};--u:${u.toFixed(3)}px">${label(shortOf(s.id), s.n, s.n * u)}</span>`).join('')}</span></span>`;
  }
  if (free) html += segHTML(free, i, side, u);
  return html;
}
function rowHTML(r) {
  const g = geo, t = at(r.i);
  const firstOfDay = r.i === 0 || dayOf(at(r.i - 1)) !== dayOf(t);
  const u = g.unit * Math.min(1, CAP / Math.max(1, r.total));
  const quiet = !r.gave.length && !r.took.length;
  const marks = [
    r.asked.length ? `<span class="y-ans" role="button" tabindex="0" data-answer="${r.i}">↩${r.asked.length > 1 ? `<sub>${r.asked.length}</sub>` : ''}</span>` : '',
    r.annotations.length ? `<span class="y-ann" title="${esc(r.annotations.map(a => a.text).join(' / '))}">✎</span>` : '',
  ].join('');
  const tags = r.i === 0 ? '空状态：64 份全是留白' : [...r.tags, r.total > CAP ? `本行按 ${(CAP / r.total).toFixed(2)} 缩放` : ''].filter(Boolean).join(' · ');
  return `<div class="y-row${firstOfDay ? ' is-dayfirst' : ''}${quiet ? ' is-quiet' : ''}" data-row="${r.i}" style="transform:translateY(${(g.HEAD + r.i * g.rowH).toFixed(1)}px);height:${g.rowH.toFixed(1)}px;--bar:${g.bar}px;--font:${g.font}px">
    <div class="y-when" data-st="go" data-frame="${r.i}" title="跳到这一帧">${firstOfDay ? `<b>${dayOf(t)}</b><span>${weekdayOf(t)}</span>` : ''}<time>${formatTime(t)}</time></div>
    <div class="y-resp">${marks}</div>
    <div class="y-wing y-l"><div class="y-fill">${wingHTML(r.gave, r.i, 'l', u)}</div></div>
    <div class="y-spine">${quiet ? '<i class="y-still"></i>' : '<i class="y-flow"></i>'}<span>${r.free}</span></div>
    <div class="y-wing y-r"><div class="y-fill">${wingHTML(r.took, r.i, 'r', u)}</div></div>
    <div class="y-note"><span class="y-t">${esc(frames[r.i].title)}</span>${g.rowH >= 30 ? `<span class="y-g">${esc(tags)}</span>` : ''}</div>
  </div>`;
}
function headHTML() {
  const g = geo;
  let ticks = '';
  for (let n = 0; n <= CAP; n += 6) for (const dir of [-1, 1]) {
    const x = g.WHEN + g.RESP + g.wing + g.SPINE / 2 + dir * (g.SPINE / 2 + n * g.unit);
    ticks += `<i style="left:${x.toFixed(1)}px"></i>${n ? `<span style="left:${x.toFixed(1)}px">${n}</span>` : ''}`;
  }
  return `<div class="y-head" style="--when:${g.WHEN}px">
    <b style="left:0">整理</b>
    <b class="y-h-l" style="right:${(g.W - g.WHEN - g.RESP - g.wing - 6).toFixed(1)}px">← 让出</b>
    <span class="y-h-spine" style="left:${(g.WHEN + g.RESP + g.wing).toFixed(1)}px;width:${g.SPINE}px">留白</span>
    <b style="left:${(g.WHEN + g.RESP + g.wing + g.SPINE + 6).toFixed(1)}px">拿到 →</b>
    <b style="left:${(g.W - g.NOTE + 4).toFixed(1)}px">这一轮</b>
    <div class="y-scale">${ticks}</div></div>`;
}

const els = { rows: [] };
function render() {
  geo = measure();
  const g = geo;
  figure.style.setProperty('--when', `${g.WHEN}px`); figure.style.setProperty('--resp', `${g.RESP}px`);
  figure.style.setProperty('--wing', `${g.wing}px`); figure.style.setProperty('--spine', `${g.SPINE}px`);
  figure.style.setProperty('--note', `${g.NOTE}px`);
  figure.innerHTML = `${headHTML()}<div class="y-rows">${rows.map(rowHTML).join('')}</div>
    <div class="y-now" style="height:${g.rowH.toFixed(1)}px"></div>`;
  els.rows = [...figure.querySelectorAll('.y-row')];
  els.now = figure.querySelector('.y-now');
  index = -1;
  update(stage.index, null);
  applyLight();
}

// ---------- frame changes ----------
let index = -1;
function update(next, previous) {
  const g = geo;
  els.rows.forEach((row, i) => {
    const past = i <= next;
    row.classList.toggle('is-future', !past);
    row.classList.toggle('is-current', i === next);
  });
  const entering = previous != null && next > previous && !reduced() ? els.rows.slice(previous + 1, next + 1) : [];
  // Rows keep `enter` until the next change (the animation ends in its final state), so no timers race the animation.
  for (const row of figure.querySelectorAll('.y-row.enter')) if (!entering.includes(row)) row.classList.remove('enter');
  if (entering.length) {
    const step = entering.length > 1 ? Math.min(45, 320 / entering.length) : 0;
    for (const row of entering) row.classList.remove('enter');
    void figure.offsetWidth;
    entering.forEach((row, k) => { row.style.setProperty('--d', `${Math.round(k * step)}ms`); row.classList.add('enter'); });
  }
  els.now.style.transform = `translateY(${(g.HEAD + next * g.rowH).toFixed(1)}px)`;
  index = next;
}
stage.onFrame((next, previous) => update(next, previous));

// ---------- highlight, pin, detail ----------
let hover = null, pinned = null, pinnedLead = null;
const lit = new Set();
function applyLight() {
  const id = hover ?? pinned;
  for (const el of lit) el.classList.remove('is-lit', 'is-peer', 'has-lit');
  lit.clear();
  figure.classList.toggle('is-focus', Boolean(id));
  if (!id) return;
  for (const el of figure.querySelectorAll(`[data-item="${CSS.escape(id)}"]`)) {
    el.classList.add('is-lit'); lit.add(el);
    const rest = el.closest('.y-rest');
    if (rest) { rest.classList.add('has-lit'); lit.add(rest); }
  }
  // Same-round counterparts: where it gave, everything on the right took; where it took, the left gave.
  for (const a of appearances.get(id) || []) {
    const row = els.rows[a.i];
    if (!row) continue;
    for (const el of row.querySelectorAll(`.y-${a.side === 'l' ? 'r' : 'l'} [data-item], .y-${a.side === 'l' ? 'r' : 'l'} .y-rest`)) {
      if (!el.classList.contains('is-lit')) { el.classList.add('is-peer'); lit.add(el); }
    }
  }
}
function setRestOpen(k, open) {
  const el = figure.querySelector(`[data-rest="${k}"]`);
  if (!el) return;
  el.classList.toggle('is-open', open);
  el.setAttribute('aria-expanded', String(open));
  el.querySelectorAll('.y-sub').forEach(sub => { sub.tabIndex = open ? 0 : -1; });
}
function pin(id, lead = null) {
  // Unfold the small-share groups that hold the pinned item, so it is visible in every row.
  for (const k of autoOpen) if (!openRest.has(k)) setRestOpen(k, unfoldAll);
  autoOpen.clear();
  pinned = id; pinnedLead = lead;
  if (id && id !== 'free') for (const a of appearances.get(id) || []) {
    const el = figure.querySelector(`[data-rest="${restKey(a.i, a.side)}"]`);
    if (el && el.querySelector(`[data-item="${CSS.escape(id)}"]`) && !el.classList.contains('is-open')) { autoOpen.add(restKey(a.i, a.side)); setRestOpen(restKey(a.i, a.side), true); }
  }
  applyLight();
  stage.showDetail(id ? detail : null);
}
stage.onEscape = () => { if (!pinned) return false; pin(null); return true; };

const signed = n => (n > 0 ? `+${n}` : `${n}`);
const nameChip = id => (id === 'free' ? '<span class="y-chip y-chip-free">留白</span>' : `<span class="y-chip" data-pin="${esc(id)}" style="--c:${colorOf(id)}">${esc(shortOf(id))}</span>`);
const peersText = list => list.map(s => `<span class="y-peer">${nameChip(s.id)}<small>${s.n}</small></span>`).join('');
function exchangeLine(a, current) {
  const row = rows[a.i];
  const counter = a.side === 'l' ? row.took : row.gave;
  const after = a.after === 0 && a.id !== 'free' ? (records[a.i].snapshot.items[a.id]?.status === 'merged' ? '并入' : '撤下') : a.after;
  return `<li class="${a.i > current ? 'is-later' : ''}${a.i === current ? ' is-now' : ''}"><button type="button" data-st="go" data-frame="${a.i}"><time>${esc(dayTime(frames[a.i].at))}</time></button>
    <b>${a.before || '新增'} → ${after}</b><span class="y-dir">${a.side === 'l' ? '同轮拿到' : '让出方'}</span><span class="y-peers">${peersText(counter)}</span></li>`;
}
function detail(i) {
  const id = pinned;
  if (id === 'free') {
    const list = rows.slice(1, i + 1).filter(r => r.gave.some(s => s.id === 'free') || r.took.some(s => s.id === 'free'));
    return { kicker: '留白 · 固定', title: `此刻留白 ${rows[i].free} / 64`,
      body: `<p class="st-muted">留白是没有分配的份额：左边是这一轮被动用的，右边是退回的。</p><section><h4>动用与退回</h4><ul class="y-exch">${list.slice(-14).map(r => exchangeLine(appearances.get('free').find(a => a.i === r.i), i)).join('')}</ul></section>` };
  }
  const mine = (appearances.get(id) || []);
  const now = records[i].snapshot.items[id];
  const share = shareMaps[i].get(id);
  const kicker = `${now ? kindWord(now) : '尚未出现'}${share ? ` · ${share} / 64` : ''} · 固定`;
  let lead = '';
  if (pinnedLead) {
    const r = rows[pinnedLead];
    const answers = r.answers.filter(a => a.link.target === id);
    const later = mine.filter(a => a.side === 'l' && a.i >= pinnedLead);
    lead = `<section class="y-answer"><h4>作答</h4>${foldSentences(answers).map(x => `<p><time>${esc(dayTime(x.first.event.at))}</time> ${esc(x.label)}<br><small>答「${esc(askById(x.first.link.ask)?.prompt || '')}」</small></p>`).join('')}
      <h4>之后份额让给了谁</h4>${later.length ? `<ul class="y-exch">${later.map(a => exchangeLine(a, i)).join('')}</ul><p class="st-muted y-fine">回执只记每件事增减多少，没有记谁为谁让位；这里列的是同一轮里拿到份额的事项。灰色是此刻之后的轮次。</p>` : '<p class="st-muted">到最后一帧它都没有让出份额。</p>'}</section>`;
  }
  // With an answer in front, the rounds after it are already listed above.
  const upto = mine.filter(a => a.i <= i && (pinnedLead == null || a.i < pinnedLead || a.side === 'r'));
  const exch = upto.length ? `<section><h4>份额往来 <small>${upto.length} 轮</small></h4><ul class="y-exch">${upto.slice(-10).map(a => exchangeLine(a, i)).join('')}</ul>${upto.length > 10 ? `<p class="st-muted">更早还有 ${upto.length - 10} 轮。</p>` : ''}</section>` : '';
  return { kicker, title: `<span class="y-title-chip" style="--c:${colorOf(id)}"></span>${esc(titleAt(id, i))}`, body: itemDetailHTML(id, i, { lead: lead + exch }) };
}
function overview(i) {
  const r = rows[i];
  if (i === 0) return { kicker: `这一轮 · ${frames[0].id}`, title: esc(frames[0].title), body: '<p>还没有整理过任何输入：64 份全是留白。按 → 或空格开始。</p>' };
  const line = (list, word) => list.length ? `<ul class="y-list">${list.map(s => `<li>${nameChip(s.id)}<span>${s.before === 0 && s.id !== 'free' ? '新增' : s.before} → ${s.after === 0 && s.id !== 'free' ? '0' : s.after}</span><b>${signed(word === 'gave' ? -s.n : s.n)}</b></li>`).join('')}</ul>` : '<p class="st-muted">—</p>';
  const responses = responsesIn(i);
  const answers = responses.filter(x => x.link.ask);
  return {
    kicker: `这一轮 · ${frames[i].id} · ${records[i].state.revision}`,
    title: esc(frames[i].title),
    body: `<p class="y-eq"><b>让出 ${r.total}</b><span>=</span><b>拿到 ${r.total}</b><small>此后留白 ${r.free} / 64</small></p>
      ${r.total ? `<div class="y-cols"><section><h4>← 让出</h4>${line(r.gave, 'gave')}</section><section><h4>拿到 →</h4>${line(r.took, 'took')}</section></div>` : '<p class="st-muted">这一轮份额没有变化。</p>'}
      ${answers.length ? `<section><h4>你作答的问题 <small>点开看份额去向</small></h4><ul class="y-list y-answers">${foldSentences(answers).map(x => `<li><button type="button" data-answer-pin="${esc(x.first.link.target)}" data-answer-row="${i}">↩ ${esc(x.label)}</button></li>`).join('')}</ul></section>` : ''}
      ${responses.length > answers.length ? `<p class="st-muted">另有 ${responses.length - answers.length} 条你在来源处的动作，指向事项但没有回答登记的问题。</p>` : ''}
      ${r.annotations.length ? `<section><h4>${esc(personName)}的批注</h4>${r.annotations.map(a => `<p>「${esc(a.text)}」</p>`).join('')}</section>` : ''}
      ${frames[i].narrative ? `<section><h4>旁白 <small>演示数据</small></h4><p>${esc(frames[i].narrative)}</p></section>` : ''}
      ${scaled.length ? `<p class="st-muted y-fine">${scaled.map(x => `${dayTime(frames[x.i].at)}`).join('、')} 一轮挪动超过 ${CAP} 份，那一行按比例缩小，左右仍等长。</p>` : ''}`,
  };
}
stage.setOverview(overview);

// ---------- pointer and keyboard ----------
function tipFor(el) {
  if (el.matches('[data-rest]')) {
    const [i, side] = el.dataset.rest.split(':');
    const list = (side === 'l' ? rows[i].gave : rows[i].took).filter(s => s.id !== 'free' && s.n <= SMALL);
    return `<b>其余 ${list.length} 件 · ${side === 'l' ? '让出' : '拿到'} ${list.reduce((s, x) => s + x.n, 0)} 份</b><br>${list.map(s => `${esc(shortOf(s.id))} ${s.before}→${s.after}`).join('　')}<br><small>点开逐件</small>`;
  }
  if (el.matches('.y-note')) {
    const r = rows[el.closest('.y-row').dataset.row];
    return `<b>${esc(frames[r.i].title)}</b>${r.tags.length ? `<br>${esc(r.tags.join(' · '))}` : ''}<br><small>让出 ${r.total} = 拿到 ${r.total} · 此后留白 ${r.free}</small>`;
  }
  if (el.matches('[data-answer]')) {
    return foldSentences(rows[el.dataset.answer].answers).map(x => esc(x.label)).join('<br>') + '<br><small>这一轮你答了登记的问题 · 点开看份额让给了谁</small>';
  }
  const i = Number(el.dataset.i), side = el.dataset.side, id = el.dataset.item;
  const s = (side === 'l' ? rows[i].gave : rows[i].took).find(x => x.id === id);
  if (!s) return '';
  const name = id === 'free' ? '留白' : titleAt(id, i);
  return `<b>${esc(name)}</b><br>${esc(dayTime(frames[i].at))}　${s.before} → ${s.after}（${signed(side === 'l' ? -s.n : s.n)}）<br><small>${side === 'l' ? (id === 'free' ? '动用留白' : '让出') : (id === 'free' ? '退回留白' : '拿到')} · 点击固定，看它每一轮的往来</small>`;
}
const markOf = target => target.closest?.('[data-item],[data-rest],[data-answer],.y-note');
figure.addEventListener('pointerover', event => {
  const el = markOf(event.target);
  if (!el || !figure.contains(el)) return;
  const id = el.dataset.item || null;
  if (hover !== id) { hover = id; applyLight(); }
  stage.tip(tipFor(el), el);
});
figure.addEventListener('pointerout', event => {
  const el = markOf(event.target);
  if (!el || el.contains(event.relatedTarget)) return;
  const next = markOf(event.relatedTarget || document.body);
  if (next && figure.contains(next)) return;
  hover = null; applyLight(); stage.untip();
});
figure.addEventListener('focusin', event => {
  const el = markOf(event.target);
  if (!el) return;
  hover = el.dataset.item || null; applyLight(); stage.tip(tipFor(el), el);
});
figure.addEventListener('focusout', () => { hover = null; applyLight(); stage.untip(); });
function activate(el) {
  if (el.matches('.y-note')) { stage.go(Number(el.closest('.y-row').dataset.row)); return; }
  if (el.matches('[data-rest]')) {
    const k = el.dataset.rest, open = !el.classList.contains('is-open');
    if (open) openRest.add(k); else openRest.delete(k);
    autoOpen.delete(k);
    setRestOpen(k, open);
    stage.tip(tipFor(el), el);
    return;
  }
  if (el.matches('[data-answer]')) {
    const r = rows[el.dataset.answer];
    pin(r.answers[0].link.target, r.i);
    return;
  }
  const id = el.dataset.item;
  pin(pinned === id && !pinnedLead ? null : id);
}
figure.addEventListener('click', event => {
  const el = markOf(event.target);
  if (el) { event.stopPropagation(); activate(el); }
});
figure.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  const el = markOf(event.target);
  if (el) { event.preventDefault(); activate(el); }
});
document.querySelector('.st-side').addEventListener('click', event => {
  const chip = event.target.closest('[data-pin]');
  if (chip) { pin(chip.dataset.pin); return; }
  const answer = event.target.closest('[data-answer-pin]');
  if (answer) pin(answer.dataset.answerPin, Number(answer.dataset.answerRow));
});
document.querySelector('.st-side').addEventListener('pointerover', event => {
  const chip = event.target.closest('[data-pin],[data-answer-pin]');
  const id = chip ? chip.dataset.pin || chip.dataset.answerPin : null;
  if (hover !== id) { hover = id; applyLight(); }
});
// ↑/↓ move between visible rows, keeping the horizontal position.
stage.onKey = event => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false;
  if (document.activeElement?.closest('.st-side')) return false;
  const current = markOf(document.activeElement);
  const focusables = row => [...row.querySelectorAll('[data-item],[data-rest],[data-answer]')].filter(el => el.tabIndex >= 0 && el.offsetParent);
  const visible = els.rows.slice(0, stage.index + 1).filter(row => focusables(row).length);
  if (!visible.length) return true;
  if (!current || !figure.contains(current)) { focusables(visible.at(-1))[0]?.focus(); return true; }
  const row = current.closest('.y-row');
  const k = visible.indexOf(row) + (event.key === 'ArrowUp' ? -1 : 1);
  const target = visible[Math.max(0, Math.min(visible.length - 1, k))];
  const x = current.getBoundingClientRect().left + current.offsetWidth / 2;
  const best = focusables(target).reduce((a, b) => (Math.abs(b.getBoundingClientRect().left + b.offsetWidth / 2 - x) < Math.abs(a.getBoundingClientRect().left + a.offsetWidth / 2 - x) ? b : a));
  best.focus();
  return true;
};
document.querySelector('.st-tools').addEventListener('click', event => {
  const b = event.target.closest('[data-y]');
  if (!b) return;
  unfoldAll = b.dataset.y === 'unfold';
  document.querySelectorAll('[data-y]').forEach(x => x.setAttribute('aria-pressed', String((x.dataset.y === 'unfold') === unfoldAll)));
  figure.querySelectorAll('[data-rest]').forEach(el => setRestOpen(el.dataset.rest, unfoldAll || openRest.has(el.dataset.rest) || autoOpen.has(el.dataset.rest)));
});

let resizeTimer = null;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });
render();
