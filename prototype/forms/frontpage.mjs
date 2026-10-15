// 04 头版：8 栏 × 8 行 = 64 格，一件事占的格数等于份额，标题字号按格数分档。
// 排版用确定的先到先占：按排名放入，左上起；剩下的格子照实印成留白。
const COLS = 8, ROWS = 8;
const SHAPES = { 24: [[6, 4], [8, 3], [4, 6]], 12: [[4, 3], [6, 2], [3, 4], [2, 6]], 6: [[3, 2], [2, 3], [6, 1], [1, 6]], 3: [[3, 1], [1, 3]], 1: [[1, 1]] };
function shapes(share) {
  if (SHAPES[share]) return SHAPES[share];
  const out = [];
  for (let w = COLS; w >= 1; w -= 1) if (share % w === 0 && share / w <= ROWS) out.push([w, share / w]);
  return out.sort((a, b) => Math.abs(a[0] / a[1] - 1.4) - Math.abs(b[0] / b[1] - 1.4));
}
export function pack(items) {
  // Depth-first search keeps rank order (each item at the first free cell that fits)
  // and tries other shapes only when a later item would not fit in eight rows.
  const grid = Array.from({ length: ROWS * 3 }, () => Array(COLS).fill(null));
  const fits = (x, y, w, h, limit) => {
    if (x + w > COLS || y + h > limit) return false;
    for (let j = y; j < y + h; j += 1) for (let i = x; i < x + w; i += 1) if (grid[j][i]) return false;
    return true;
  };
  const firstFit = (w, h, limit) => {
    for (let y = 0; y + h <= limit; y += 1) for (let x = 0; x + w <= COLS; x += 1) if (fits(x, y, w, h, limit)) return { x, y, w, h };
    return null;
  };
  const mark = (p, id) => { for (let j = p.y; j < p.y + p.h; j += 1) for (let i = p.x; i < p.x + p.w; i += 1) grid[j][i] = id; };
  function search(i, limit) {
    if (i === items.length) return [];
    for (const [w, h] of shapes(items[i].share)) {
      const p = firstFit(w, h, limit);
      if (!p) continue;
      mark(p, items[i].id);
      const rest = search(i + 1, limit);
      if (rest) return [{ item: items[i], ...p }, ...rest];
      mark(p, null);
    }
    return null;
  }
  let limit = ROWS, placed = search(0, limit);
  while (!placed) { limit += 1; placed = search(0, limit); }
  const rows = Math.max(ROWS, ...placed.map(p => p.y + p.h));
  const blanks = [];
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < COLS; x += 1) if (!grid[y][x]) blanks.push({ x, y });
  return { placed, blanks, rows };
}

export function mount(stage, model, kit) {
  const { esc, formatTime } = kit;
  stage.innerHTML = '<div class="fp-table"><article class="fp-sheet"></article></div>';
  const sheet = stage.querySelector('.fp-sheet');
  const size = share => (share >= 24 ? 'xl' : share >= 12 ? 'l' : share >= 6 ? 'm' : share >= 3 ? 's' : 'xs');
  const kicker = (s, item, ask) => (ask ? `<span class="fp-kick is-ask">请你${{ decide: '决定', input: '提供', act: '去做' }[ask.meanings?.[0]] || '回应'}</span>` : `<span class="fp-kick">${esc(kit.kindLabel[item.kind])}</span>`);
  function story(s, { item, x, y, w, h }, changes) {
    const ask = kit.currentAsk(s, item.id), c = changes.get(item.id), sz = size(item.share);
    const mark = c ? `<span class="fp-new">${c.type === 'added' || c.type === 'restored' ? '本期新' : '本期更新'}</span>` : '';
    const quotes = (item.sources || []).filter(q => q.quote).slice(-2);
    const kids = item.children?.items || [];
    const body = item.share >= 12 ? `<div class="fp-body" style="column-count:${Math.max(1, Math.floor(w / 2))}">
        ${item.share >= 24 && item.reason ? `<p><b>编者按</b> ${esc(item.reason)}</p>` : ''}
        ${quotes.map(q => `<p>【${esc(kit.author(q))} · ${esc(q.channel)}】${esc(q.quote)}</p>`).join('')}
        ${kids.length ? `<p class="fp-kids"><b>版内相关</b>${kids.map(k => `${esc(k.title)}（子层 ${k.share}/64）`).join('；')}</p>` : ''}</div>` : '';
    const askBox = ask && item.share >= 6 ? `<div class="fp-ask"><b>${esc(ask.prompt)}</b>${ask.actions.map(a => `<span>☐ ${esc(a.label)}</span>`).join('')}</div>` : '';
    return `<section class="fp-story fp-${sz}" style="grid-column:${x + 1} / span ${w};grid-row:${y + 1} / span ${h}">
      <header>${kicker(s, item, ask)}${mark}<span class="fp-share">${item.share} 份</span></header>
      <h3>${esc(item.title)}</h3>${item.share >= 3 && (h >= 2 || w >= 3) && item.summary ? `<p class="fp-deck">${esc(item.summary)}</p>` : ''}
      ${item.due_at && item.kind !== 'done' && item.share >= 6 ? `<p class="fp-due">期限 ${kit.formatDate(item.due_at)} ${formatTime(item.due_at)} · ${kit.until(Date.parse(item.due_at) - s.cursor)}</p>` : ''}
      ${askBox}${body}</section>`;
  }
  function render(s) {
    const items = s.state.root.items, changes = kit.changes(s), asks = kit.asks(s);
    const { placed, blanks, rows } = pack(items);
    const ev = s.frame.events, count = d => ev.filter(e => e.disposition === d).length;
    const signal = s.frame.signal;
    sheet.innerHTML = `<header class="fp-mast">
        <div class="fp-ear"><b>${asks.length}</b><span>个问题<br>等你回应</span></div>
        <div class="fp-title"><h1>F O L D 日 报</h1><p>第 ${esc(s.state.revision)} 版 · ${kit.formatDate(s.frame.at)} ${formatTime(s.frame.at)} · 本版 64 份 · 已排 ${s.state.root.used} 份</p></div>
        <div class="fp-ear is-right">${signal?.type === 'review' ? `<span>${esc(signal.reason)}<br>无新输入${signal.coverage ? ` · ${esc(signal.coverage)}` : ''}</span>` : `<span>本轮输入 <b>${ev.length}</b> 条<br>采用 ${count('used')} · 噪音 ${count('noise')} · 重复 ${count('duplicate')} · 暂缓 ${count('deferred')}</span>`}</div>
      </header>
      <div class="fp-strap">${esc(s.frame.title)}<small>本期导语（演示数据中的本轮旁白）</small></div>
      <div class="fp-grid" style="grid-template-rows:repeat(${rows}, 92px)">
        ${placed.map(p => story(s, p, changes)).join('')}
        ${blanks.map((b, i) => `<div class="fp-blank" style="grid-column:${b.x + 1};grid-row:${b.y + 1}">${i === 0 ? `<span>本版留白<br>${64 - s.state.root.used} 份未分配</span>` : ''}</div>`).join('')}
      </div>
      <footer class="fp-foot">版面 8 栏 × 8 行，一格一份；标题与导语照录状态原文。子层另有各自的 64 份，在“版内相关”中列出。</footer>`;
  }
  model.subscribe(s => render(s));
}
