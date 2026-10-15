// 07 到期时刻表：按 due_at 由近到远排，不按份额。每个字一片翻牌；
// 本轮有变化的行在载入时翻动，琥珀色只给登记了回应路径的事项。
export function mount(stage, model, kit) {
  const { esc, formatTime } = kit;
  stage.innerHTML = '<div class="dp-hall"><div class="dp-board"></div><p class="dp-note"></p></div>';
  const board = stage.querySelector('.dp-board');
  const flaps = (text, cls = '', changed = false) => `<span class="dp-flaps ${cls}">${[...String(text)].map((ch, i) => `<i class="${changed ? 'is-flip' : ''}" style="--d:${i * 45}ms">${ch === ' ' ? '&nbsp;' : esc(ch)}</i>`).join('')}</span>`;
  const day = at => `${String(Number(at.slice(8, 10))).padStart(2, '0')}日`;
  function status(s, item) {
    const ask = kit.currentAsk(s, item.id);
    if (ask) return { text: { decide: '等你决定', input: '等你提供', act: '等你去做' }[ask.meanings?.[0]] || '等你回应', ask: true };
    return { text: { 'needs-you': '需要你', 'in-progress': '进行中', done: '已完成', fyi: '知会' }[item.kind], ask: false };
  }
  function row(s, { item, depth }, changes) {
    const c = changes.get(item.id), st = status(s, item), due = item.due_at;
    const left = due ? Date.parse(due) - s.cursor : null;
    const note = !due ? '' : item.kind === 'done' ? (left < 0 ? '已过点 · 已完成' : '已完成') : left < 0 ? `已过点 ${kit.until(left).slice(2)}` : kit.until(left);
    const parent = depth ? kit.getItem(s.state, item.parent_id) : null;
    return `<div class="dp-row${c ? ' is-changed' : ''}${due && left < 0 && item.kind !== 'done' ? ' is-late' : ''}">
      <div class="dp-time">${due ? `${flaps(formatTime(due), 'is-num', c?.fields?.includes('due_at'))}<small>${day(due)}</small>` : flaps('--:--', 'is-num is-dim')}</div>
      <div class="dp-what">${flaps(`${depth ? '↳' : ''}${item.title}`, '', !!c)}${parent ? `<small>属于「${esc(parent.title)}」· 子层份额</small>` : ''}</div>
      <div class="dp-status">${flaps(st.text, st.ask ? 'is-ask' : '', c?.fields?.includes('kind'))}</div>
      <div class="dp-share">${flaps(String(item.share).padStart(2, ' '), 'is-num', c?.fields?.includes('share'))}</div>
      <div class="dp-left">${esc(note)}</div></div>`;
  }
  function render(s) {
    const changes = kit.changes(s), all = kit.activeItems(s.state);
    const timed = all.filter(x => x.item.due_at).sort((a, b) => Date.parse(a.item.due_at) - Date.parse(b.item.due_at));
    const untimed = all.filter(x => !x.item.due_at && x.depth === 0);
    const hiddenKids = all.filter(x => !x.item.due_at && x.depth > 0).length;
    board.innerHTML = `<header class="dp-head"><div><b>前方 · 到期</b><span>DEPARTURES BY DUE TIME</span></div>
        <div class="dp-clock">${flaps(formatTime(s.frame.at), 'is-num')}<small>${esc(kit.formatDate(s.frame.at))}</small></div></header>
      <div class="dp-cols"><span>时刻</span><span>事项</span><span>状态</span><span>份额</span><span>备注</span></div>
      ${timed.map(x => row(s, x, changes)).join('') || '<div class="dp-empty">暂无有期限的事项</div>'}
      <header class="dp-sub"><b>未定时</b><span>没有期限的根层事项，按份额排</span></header>
      ${untimed.map(x => row(s, x, changes)).join('') || '<div class="dp-empty">无</div>'}
      <footer class="dp-foot"><span>本层已用 ${s.state.root.used}/64 份 · 未分配 ${64 - s.state.root.used} 份</span><span>通告：${esc(s.frame.title)}</span></footer>`;
    stage.querySelector('.dp-note').textContent = `只有本轮改动的行会翻牌。根层份额与子层份额各自以 64 为限；${hiddenKids ? `另有 ${hiddenKids} 个没有期限的子项不上牌。` : ''}`;
  }
  model.subscribe(s => render(s));
}
