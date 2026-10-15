// 05 小票：每份 14 像素纸长；未分配是走纸留白。只有状态变了才打印新的一张，
// 所以“上一张”是此前最近一次有变化的整理；检查无变化的一轮不出纸。
const PX = 14;

export function mount(stage, model, kit) {
  const { esc, formatTime, formatDate } = kit;
  const ticked = new Set();
  stage.innerHTML = '<div class="rc-desk"><div class="rc-pair"></div><p class="rc-note"></p></div>';
  const pair = stage.querySelector('.rc-pair');
  pair.addEventListener('click', event => {
    const box = event.target.closest('[data-tick]');
    if (box) { ticked.has(box.dataset.tick) ? ticked.delete(box.dataset.tick) : ticked.add(box.dataset.tick); kit.toast('纸上的勾只在本页演示，不写回状态'); render(model.snapshot()); }
  });
  pair.addEventListener('mouseover', event => {
    const id = event.target.closest('[data-id]')?.dataset.id;
    pair.querySelectorAll('[data-id]').forEach(el => el.classList.toggle('is-hot', el.dataset.id === id));
  });

  const printedAt = index => { for (let i = index; i > 0; i -= 1) if (kit.records[i].receipt?.type !== 'checked') return i; return 0; };
  function lines(s, item, rows) {
    const out = [`<strong>${esc(item.title)}</strong>`];
    const ask = kit.currentAsk(s, item.id);
    if (rows >= 3 && item.summary) out.push(`<span class="rc-sum">${esc(item.summary)}</span>`);
    if (rows >= 6 && item.due_at && item.kind !== 'done') out.push(`<span>期限 ${formatDate(item.due_at)} ${formatTime(item.due_at)}</span>`);
    if (rows >= 6 && ask) {
      out.push(`<span class="rc-q">${esc(ask.prompt)}</span>`);
      ask.actions.forEach((a, i) => { const key = `${item.id}|${item.updated_at}|${i}`; out.push(`<span class="rc-box" data-tick="${esc(key)}">${ticked.has(key) ? '☑' : '☐'} ${esc(a.label)}</span>`); });
    }
    if (rows >= 12 && item.children) out.push(`<span>↳ ${item.children.items.length} 个子项，另有 64 份</span>`);
    if (rows >= 24 && item.sources?.length) { const q = item.sources.at(-1); out.push(`<span class="rc-quote">${esc(q.quote || '')} ——${esc(kit.author(q))}</span>`); }
    return out.join('');
  }
  function slip(s, index, label, compareTo) {
    const record = kit.records[index], state = record.state, items = state.root.items;
    const prev = compareTo ? new Map(compareTo.state.root.items.map(i => [i.id, i])) : null;
    const ctx = { index, state };
    const body = items.map(item => {
      const ask = kit.currentAsk(ctx, item.id);
      const was = prev?.get(item.id);
      const delta = !prev ? '' : !was ? '<em class="rc-delta">新</em>' : was.share !== item.share ? `<em class="rc-delta">${was.share}→${item.share}</em>` : '';
      return `<section class="rc-item" data-id="${esc(item.id)}" style="height:${item.share * PX}px">
        <div class="rc-ruler" style="--n:${item.share}"><b>${item.share}</b></div>
        <div class="rc-text">${ask ? '<span class="rc-flag">请回应</span>' : `<span class="rc-kind">${esc(kit.kindLabel[item.kind])}</span>`}${lines(ctx, item, item.share)}</div>${delta}</section>`;
    }).join('');
    const blank = 64 - state.root.used;
    const gone = prev ? [...prev.values()].filter(i => !items.some(x => x.id === i.id)) : [];
    return `<figure class="rc-slip"><figcaption>${label}</figcaption><div class="rc-paper">
      <header><div class="rc-brand">FOLD</div><div>${formatDate(kit.scenario.frames[index].at)} ${formatTime(kit.scenario.frames[index].at)} · 第 ${esc(state.revision)} 版</div><div>本层 64 份 · 已印 ${state.root.used} 份</div></header>
      ${body}${blank ? `<section class="rc-blank" style="height:${blank * PX}px"><span>（未分配 ${blank} 份 · 走纸留白）</span></section>` : ''}
      ${gone.length ? `<div class="rc-gone">上一张有、这张没有：${gone.map(g => esc(g.title)).join('；')}</div>` : ''}
      <footer>- - - - ✂ 沿此撕下 - - - -<br>有变化才打印下一张</footer></div></figure>`;
  }
  function render(s) {
    const current = printedAt(s.index), previous = current > 0 ? printedAt(current - 1) : null;
    const quiet = current !== s.index;
    pair.innerHTML = `${previous !== null && current > 0 ? slip(s, previous, `上一张 · ${kit.scenario.frames[previous].id}`) : '<figure class="rc-slip is-none"><figcaption>上一张</figcaption><div class="rc-none">还没有打印过</div></figure>'}
      ${slip(s, current, quiet ? `仍是 ${kit.scenario.frames[current].id} 那一张` : `这一张 · ${kit.scenario.frames[current].id}`, previous !== null && current > 0 ? kit.records[previous] : null)}`;
    stage.querySelector('.rc-note').innerHTML = quiet ? `<b>本轮没有出纸。</b>${esc(kit.dayTime(s.frame.at))} 的整理只是检查，状态没有变化，所以不打印新的一张。` : '每份 14 像素纸长，左侧刻度一格一份；右边距的数字是相对上一张的份额变化。悬停一段，两张纸上同一件事一起高亮。';
  }
  model.subscribe(s => render(s));
}
