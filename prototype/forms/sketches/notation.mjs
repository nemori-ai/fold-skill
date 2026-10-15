// 05 批次记谱（完整版）：一次整理记一行。收到几条、各怎么判；登记、失效、答了几个问题；
// 新增、变大、撤下几件（变小与只改内容只记一个数）；回执；旁白全文。
// 朱红只表示来自你本人：你的输入、批注与回应。点一行跳到那一帧，链接带着 ?frame= 去其他形式。
import {
  createStage, esc, frames, records, dayTime, formatTime, colorOf, shortOf, titleAt, responsesIn, foldSentences,
  askLife, itemDetailHTML, kindWord, reduced, isSelf,
} from './stage.mjs';
import { dayOf, weekdayOf, at, textWidth } from './kit.mjs';

const key = `
  <span>收到：<svg width="58" height="10"><rect x="0" y="2" width="22" height="7" fill="var(--ink)"/><rect x="22" y="2" width="10" height="7" fill="var(--ink-3)"/><rect x="32" y="2" width="14" height="7" fill="var(--line)"/><rect x="0" y="0" width="9" height="2" fill="var(--vermilion)"/></svg>采用 · 暂缓或重复 · 噪音；上沿朱红 = 你自己的输入</span>
  <span>问题：<b class="n-k">◆</b>新登记 <b class="n-k n-lapsed">◇</b>失效 <b class="n-k n-you">↩</b>你答了</span>
  <span>改动：<b class="n-k">＋</b>新增 <b class="n-k">▲</b>变大 <b class="n-k">⊘</b>撤下 <b class="n-k">⋈</b>合并，一个记号一件；<span class="n-faint">▼ 变小 ◇ 只改内容</span>只记件数</span>
  <span class="note"><kbd>←</kbd><kbd>→</kbd> 逐帧 <kbd>空格</kbd> 播放 · 点一行跳到那一帧 · 朱红只表示来自你本人</span>`;
const stage = createStage({
  id: 'notation', no: 5, name: '批次记谱', storyIndex: 36, key,
  relation: '每一轮整理由什么组成：收到几条、各怎么判，对哪几件事做了什么；两周里整理的疏密，和你插话的时刻。',
});
const figure = stage.figure;

// ---------- data ----------
const DISPOSITIONS = ['used', 'duplicate', 'deferred', 'noise', 'unjudged'];
const dispWord = { used: '采用', duplicate: '重复', deferred: '暂缓', noise: '噪音', unjudged: '未判' };
const streamWord = { work: '工作', family: '家庭', community: '社区', life: '生活', subscription: '订阅' };
const opWord = { new: '新增', up: '变大', withdraw: '撤下', merge: '合并', down: '变小', same: '只改内容' };
const opGlyph = { new: '＋', up: '▲', withdraw: '⊘', merge: '⋈', down: '▼', same: '◇' };
const rows = frames.map((frame, i) => {
  const counts = Object.fromEntries(DISPOSITIONS.map(d => [d, 0]));
  const streams = {};
  let self = 0;
  for (const e of frame.events) {
    counts[DISPOSITIONS.includes(e.disposition) ? e.disposition : 'unjudged'] += 1;
    if (e.stream) streams[e.stream] = (streams[e.stream] || 0) + 1;
    if (isSelf(e)) self += 1;
  }
  // What the batch did to each item, read from the replayed diff (children included).
  const ops = { new: [], up: [], withdraw: [], merge: [], down: [], same: [] };
  for (const c of records[i].diff.changes || []) {
    if (c.type === 'annotations_changed') continue;
    const before = c.before?.share, after = c.after?.share;
    const op = c.type === 'added' ? 'new' : c.type === 'restored' ? 'up' : c.type === 'withdrawn' ? 'withdraw' : c.type === 'merged' ? 'merge'
      : before != null && after != null && after > before ? 'up' : before != null && after != null && after < before ? 'down' : 'same';
    ops[op].push({ id: c.item, before, after, fields: c.fields });
  }
  const life = askLife[i];
  return {
    i, n: frame.events.length, counts, streams, self, ops, life,
    gap: i ? (at(i) - at(i - 1)) / 3600000 : null,
    annotations: frame.annotations || [],
    receipt: records[i].receipt,
  };
});
const maxInputs = Math.max(1, ...rows.map(r => r.n));
const opsOf = new Map();
for (const r of rows) for (const [op, list] of Object.entries(r.ops)) for (const x of list) {
  if (!opsOf.has(x.id)) opsOf.set(x.id, []);
  opsOf.get(x.id).push({ i: r.i, op, ...x });
}

// ---------- layout ----------
let geo = null;
function measure() {
  const W = figure.clientWidth, H = figure.clientHeight, HEAD = 28;
  const rowH = Math.max(16, Math.min(32, (H - HEAD - 4) / frames.length));
  const cols = { when: 86, gap: 44, inputs: 214, asks: 88, ops: 176, trace: 22, receipt: 54 };
  cols.title = W - Object.values(cols).reduce((s, x) => s + x, 0);
  return { W, H, HEAD, rowH, cols };
}
// One mark per thing up to `max`; beyond that the mark and a count, so a busy round never pushes into the next column.
const tally = (glyph, n, cls = '', max = 12) => (!n ? '' : `<span class="n-tally ${cls}">${n <= max ? glyph.repeat(n) : `${glyph}<small>×${n}</small>`}</span>`);
function titleHTML(text, width, rowH) {
  // Never cut the narration: shrink a little, then wrap to two lines.
  for (const size of [12, 11.5, 11]) if (textWidth(text, size) <= width - 4) return `<span class="n-title" style="font-size:${size}px">${esc(text)}</span>`;
  const size = rowH >= 26 ? 11 : 10;
  return `<span class="n-title is-two" style="font-size:${size}px">${esc(text)}</span>`;
}
function rowHTML(r) {
  const g = geo, t = at(r.i), c = g.cols;
  const firstOfDay = r.i === 0 || dayOf(at(r.i - 1)) !== dayOf(t);
  const barW = c.inputs - 44;
  const scale = barW / maxInputs;
  let x = 0;
  const segs = DISPOSITIONS.map(d => {
    const w = r.counts[d] * scale;
    const seg = w ? `<i class="n-d n-${d}" style="left:${x.toFixed(2)}px;width:${Math.max(1, w - 0.5).toFixed(2)}px"></i>` : '';
    x += w;
    return seg;
  }).join('');
  const you = r.self ? `<i class="n-self" style="width:${Math.max(2, r.self * scale).toFixed(2)}px"></i>` : '';
  const inputs = r.n ? `<span class="n-bar" style="width:${(r.n * scale).toFixed(2)}px">${segs}${you}</span><span class="n-count">${r.n}</span>`
    : `<span class="n-empty">${r.i === 0 ? '— 空状态' : '— 定时整理，无输入'}</span>`;
  const ann = r.annotations.length ? `<span class="n-ann" title="${esc(r.annotations.map(a => a.text).join(' / '))}">✎${r.annotations.length > 1 ? r.annotations.length : ''}</span>` : '';
  const askMax = r.life.fresh.length + r.life.lapsed.length + r.life.answered.length > 6 ? 1 : 6;
  const asks = `${tally('◆', r.life.fresh.length, 'n-fresh', askMax)}${tally('◇', r.life.lapsed.length, 'n-lapsed', askMax)}${tally('↩', r.life.answered.length, 'n-you', askMax)}`;
  const quiet = [r.ops.down.length ? `▼${r.ops.down.length}` : '', r.ops.same.length ? `◇${r.ops.same.length}` : ''].filter(Boolean).join(' ');
  // Each mark is one item: hover it to see that item's mark in every round.
  const marks = (op, glyph) => (!r.ops[op].length ? '' : r.ops[op].length > 12 ? tally(glyph, r.ops[op].length)
    : `<span class="n-tally">${r.ops[op].map(x => `<i data-item="${esc(x.id)}" data-op="${op}">${glyph}</i>`).join('')}</span>`);
  const ops = `${marks('new', '＋')}${marks('up', '▲')}${marks('withdraw', '⊘')}${marks('merge', '⋈')}${quiet ? `<span class="n-quiet">${quiet}</span>` : ''}`;
  const receipt = !r.receipt ? '' : r.receipt.type === 'checked' ? '检查' : `${esc(r.receipt.revision)}${r.receipt.acknowledges?.length ? '·批' : ''}`;
  // The rule's length is the gap; the hours are written only where the cadence changes.
  const changed = r.gap != null && (r.i < 2 || Math.round(rows[r.i - 1].gap) !== Math.round(r.gap));
  const gap = r.gap == null ? '' : `<i style="width:${Math.max(2, Math.min(1, r.gap / 16) * 30).toFixed(1)}px"></i>${r.gap >= 10 && changed ? `<small>${Math.round(r.gap)}h</small>` : ''}`;
  return `<div class="n-row${firstOfDay ? ' is-dayfirst' : ''}" data-row="${r.i}" style="transform:translateY(${(g.HEAD + r.i * g.rowH).toFixed(1)}px);height:${g.rowH.toFixed(1)}px">
    <div class="n-when">${firstOfDay ? `<b>${dayOf(t)}</b><span>${weekdayOf(t)}</span>` : ''}<time>${formatTime(t)}</time></div>
    <div class="n-gap">${gap}</div>
    <div class="n-inputs" data-part="inputs">${inputs}${ann}</div>
    <div class="n-asks" data-part="asks">${asks}</div>
    <div class="n-ops" data-part="ops">${ops}</div>
    <div class="n-trace"></div>
    <div class="n-receipt">${receipt}</div>
    <div class="n-say">${titleHTML(frames[r.i].title, c.title, g.rowH)}</div>
  </div>`;
}
const els = { rows: [] };
function render() {
  geo = measure();
  const c = geo.cols;
  figure.style.cssText = Object.entries(c).map(([k, v]) => `--${k}:${v}px`).join(';');
  figure.innerHTML = `<div class="n-head"><b>整理</b><b>间隔</b><b>收到 <small>条数 · 怎么判</small></b><b>问题</b><b>改动 <small>件数</small></b><b></b><b>回执</b><b>这一轮（旁白）</b></div>
    <div class="n-rows">${rows.map(rowHTML).join('')}</div><div class="n-now" style="height:${geo.rowH.toFixed(1)}px"></div>`;
  els.rows = [...figure.querySelectorAll('.n-row')];
  els.now = figure.querySelector('.n-now');
  update(stage.index, null);
  applyTrace();
}

// ---------- frame changes ----------
function update(next, previous) {
  els.rows.forEach((row, i) => { row.classList.toggle('is-future', i > next); row.classList.toggle('is-current', i === next); });
  const entering = previous != null && next > previous && !reduced() ? els.rows.slice(previous + 1, next + 1) : [];
  for (const row of figure.querySelectorAll('.n-row.enter')) if (!entering.includes(row)) row.classList.remove('enter');
  if (entering.length) {
    const step = entering.length > 1 ? Math.min(40, 300 / entering.length) : 0;
    for (const row of entering) row.classList.remove('enter');
    void figure.offsetWidth;
    entering.forEach((row, k) => { row.style.setProperty('--d', `${Math.round(k * step)}ms`); row.classList.add('enter'); });
  }
  els.now.style.transform = `translateY(${(geo.HEAD + next * geo.rowH).toFixed(1)}px)`;
}
stage.onFrame((next, previous) => update(next, previous));

// ---------- the same item across rounds ----------
let hover = null, pinned = null;
let hits = [];
function applyTrace() {
  const id = hover ?? pinned;
  figure.classList.toggle('is-trace', Boolean(id));
  for (const el of hits) el.classList.remove('is-hit');
  hits = id ? [...figure.querySelectorAll(`.n-tally i[data-item="${CSS.escape(id)}"]`)] : [];
  for (const el of hits) el.classList.add('is-hit');
  for (const row of els.rows) {
    const cell = row.querySelector('.n-trace');
    const hit = id ? (opsOf.get(id) || []).find(x => x.i === Number(row.dataset.row)) : null;
    cell.innerHTML = hit ? `<b class="n-op-${hit.op}" title="${opWord[hit.op]}">${opGlyph[hit.op]}</b>` : '';
    row.classList.toggle('is-traced', Boolean(hit));
  }
}
const chip = id => `<span class="n-chip" role="button" tabindex="0" data-pin="${esc(id)}" style="--c:${colorOf(id)}">${esc(shortOf(id))}</span>`;
function pin(id) {
  pinned = id;
  applyTrace();
  stage.showDetail(id ? itemDetail : null);
}
stage.onEscape = () => { if (!pinned) return false; pin(null); return true; };
function itemDetail(i) {
  const id = pinned, item = records[i].snapshot.items[id];
  const list = (opsOf.get(id) || []).filter(x => x.i <= i);
  const lead = `<section><h4>在每一轮 <small>${list.length} 次改动</small></h4><ul class="n-hist">${list.slice(-12).map(x => `<li class="${x.i === i ? 'is-now' : ''}"><button type="button" data-st="go" data-frame="${x.i}"><time>${esc(dayTime(frames[x.i].at))}</time></button><b>${opGlyph[x.op]} ${opWord[x.op]}</b><span>${x.before != null && x.after != null && x.before !== x.after ? `${x.before} → ${x.after} 份` : x.after != null && x.before == null ? `${x.after} 份` : ''}</span></li>`).join('')}</ul></section>`;
  return { kicker: `${item ? kindWord(item) : '尚未出现'} · 固定`, title: `<span class="n-title-chip" style="--c:${colorOf(id)}"></span>${esc(titleAt(id, i))}`, body: itemDetailHTML(id, i, { lead }) };
}

// ---------- this round ----------
function overview(i) {
  const r = rows[i], f = frames[i];
  const sig = f.signal;
  const window = sig?.window ? `${formatTime(sig.window.from)}–${formatTime(sig.window.to)}` : '';
  const chips = list => list.map(x => `${chip(x.id)}${x.before != null && x.after != null && x.before !== x.after ? `<small>${x.before}→${x.after}</small>` : ''}`).join(' ');
  const opsBlock = ['new', 'up', 'withdraw', 'merge', 'down', 'same'].filter(op => r.ops[op].length)
    .map(op => `<li><b>${opGlyph[op]} ${opWord[op]} ${r.ops[op].length}</b><span class="n-chips">${chips(r.ops[op])}</span></li>`).join('');
  const responses = responsesIn(i);
  const linked = new Set(responses.map(x => x.event.id));
  const unlinked = f.events.filter(e => isSelf(e) && !linked.has(e.id));
  const askLine = (ask, word) => `<li><b>${word}</b><span>${esc(ask.prompt)}<small>${chip(ask.item)}</small></span></li>`;
  const asks = [...r.life.fresh.map(a => askLine(a, '◆ 登记')), ...r.life.lapsed.map(a => askLine(a, '◇ 失效')), ...r.life.answered.map(a => askLine(a, '↩ 答了'))].join('');
  return {
    kicker: `这一轮 · ${f.id} · ${records[i].state.revision}${window ? ` · 窗口 ${window}` : ''}`,
    title: esc(f.title),
    body: `${f.narrative ? `<p class="n-narr">${esc(f.narrative)}</p>` : ''}
      <section><h4>收到 <small>${r.n} 条${sig?.reason ? ` · ${esc(sig.reason)}` : ''}</small></h4>
        ${r.n ? `<p class="n-split">${DISPOSITIONS.filter(d => r.counts[d]).map(d => `<span><i class="n-sw n-${d}"></i>${dispWord[d]} ${r.counts[d]}</span>`).join('')}</p>
        ${Object.keys(r.streams).length ? `<p class="st-muted">${Object.entries(r.streams).map(([s, n]) => `${streamWord[s] || s} ${n}`).join(' · ')}${sig?.coverage && /另有/.test(sig.coverage) ? `（${esc(sig.coverage.match(/（(.*)）/)?.[1] || '')}）` : ''}</p>` : ''}` : `<p class="st-muted">${i === 0 ? '空状态，还没有输入。' : '窗口内没有新输入，这是一次定时整理。'}</p>`}
      </section>
      ${r.self || r.annotations.length ? `<section class="n-yours"><h4>来自你 <small>${r.self} 条输入${r.annotations.length ? ` · ${r.annotations.length} 条批注` : ''}</small></h4>
        ${responses.length ? `<ul class="n-acts">${foldSentences(responses).map(x => `<li>${esc(x.label)}${x.item ? ` ${chip(x.item)}` : ''}${x.first.link.ask ? '<small>答登记的问题</small>' : ''}</li>`).join('')}</ul>` : ''}
        ${unlinked.length ? `<p class="st-muted">${unlinked.length} 条你自己的输入没有指向事项的动作（发帖、评论别处的讨论${unlinked.some(e => e.stream === 'family') ? '、家里的消息' : ''}等）。</p>` : ''}
        ${r.annotations.map(a => `<p class="n-annot">✎「${esc(a.text)}」</p>`).join('')}</section>` : ''}
      ${asks ? `<section><h4>问题 <small>此刻开着 ${r.life.open.size} 个</small></h4><ul class="n-asklist">${asks}</ul></section>` : `<p class="st-muted">这一轮没有登记、失效或答掉的问题；此刻开着 ${r.life.open.size} 个。</p>`}
      ${opsBlock ? `<section><h4>改动 <small>悬停名字看它在每一轮的记号，点击固定</small></h4><ul class="n-opslist">${opsBlock}</ul></section>` : ''}
      <section><h4>回执</h4><p>${!r.receipt ? '没有提交批次。' : r.receipt.type === 'checked' ? `检查后状态不变（${esc(r.receipt.revision)}），不伪造新进展。` : `${esc(r.receipt.revision)}${r.receipt.acknowledges?.length ? ` · 确认了 ${r.receipt.acknowledges.length} 条批注` : ''}`}</p></section>`,
  };
}
stage.setOverview(overview);

// ---------- pointer and keyboard ----------
function tipFor(row, part) {
  const r = rows[Number(row.dataset.row)];
  if (part === 'inputs') return r.n ? `<b>${r.n} 条</b>：${DISPOSITIONS.filter(d => r.counts[d]).map(d => `${dispWord[d]} ${r.counts[d]}`).join(' · ')}${r.self ? `<br>其中你自己 ${r.self} 条` : ''}` : '没有输入';
  if (part === 'asks') {
    const list = [...r.life.fresh.map(a => `◆ ${a.prompt}`), ...r.life.lapsed.map(a => `◇ 失效：${a.prompt}`), ...r.life.answered.map(a => `↩ 答了：${a.prompt}`)];
    return list.length ? list.map(esc).join('<br>') : `问题没有变化 · 此刻开着 ${r.life.open.size} 个`;
  }
  if (part === 'ops') return ['new', 'up', 'withdraw', 'merge', 'down', 'same'].filter(op => r.ops[op].length)
    .map(op => `<b>${opGlyph[op]} ${opWord[op]}</b> ${r.ops[op].slice(0, 6).map(x => esc(shortOf(x.id))).join('、')}${r.ops[op].length > 6 ? ` 等 ${r.ops[op].length} 件` : ''}`).join('<br>') || '没有改动';
  return `<b>${esc(dayTime(frames[r.i].at))}</b> · ${esc(frames[r.i].id)}<br>${esc(frames[r.i].title)}<br><small>点击跳到这一帧</small>`;
}
figure.addEventListener('pointerover', event => {
  const row = event.target.closest('.n-row');
  if (!row) return;
  const mark = event.target.closest('[data-item]');
  const id = mark ? mark.dataset.item : null;
  if (hover !== id) { hover = id; applyTrace(); }
  if (mark) {
    const i = Number(row.dataset.row), x = rows[i].ops[mark.dataset.op].find(o => o.id === id);
    stage.tip(`<b>${esc(titleAt(id, i))}</b><br>${opWord[mark.dataset.op]}${x?.before != null && x?.after != null && x.before !== x.after ? ` · ${x.before} → ${x.after} 份` : ''}<br><small>右侧记号列是它在每一轮的改动 · 点击固定</small>`, mark);
    return;
  }
  const part = event.target.closest('[data-part]')?.dataset.part;
  stage.tip(tipFor(row, part), event.target.closest('[data-part]') || row.querySelector('.n-say'));
});
figure.addEventListener('pointerleave', () => { stage.untip(); if (hover) { hover = null; applyTrace(); } });
figure.addEventListener('click', event => {
  const row = event.target.closest('.n-row');
  if (!row) return;
  const mark = event.target.closest('[data-item]');
  stage.go(Number(row.dataset.row));
  if (mark) pin(mark.dataset.item);
  stage.untip();
});
const side = document.querySelector('.st-side');
side.addEventListener('pointerover', event => {
  const c = event.target.closest('[data-pin]');
  const id = c ? c.dataset.pin : null;
  if (hover !== id) { hover = id; applyTrace(); }
});
side.addEventListener('pointerleave', () => { if (hover) { hover = null; applyTrace(); } });
side.addEventListener('click', event => {
  const c = event.target.closest('[data-pin]');
  if (c) pin(pinned === c.dataset.pin ? null : c.dataset.pin);
});
// Chips in the side panel are reachable by Tab; focus traces like hover.
side.addEventListener('focusin', event => { const c = event.target.closest('[data-pin]'); if (c) { hover = c.dataset.pin; applyTrace(); } });
side.addEventListener('focusout', () => { if (hover) { hover = null; applyTrace(); } });
side.addEventListener('keydown', event => {
  const c = event.target.closest('[data-pin]');
  if (c && event.key === 'Enter') { event.preventDefault(); pin(pinned === c.dataset.pin ? null : c.dataset.pin); }
});
// ↑/↓ step a row too: in a log the rows are the frames.
stage.onKey = event => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false;
  if (document.activeElement?.closest('.st-side')) return false;
  stage.go(stage.index + (event.key === 'ArrowUp' ? -1 : 1));
  return true;
};

let resizeTimer = null;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });
render();
