// 03 进程条架：每件事一张固定格式的纸条，按 kind 插进四个槽。
// 印字是当前值；本轮改动像管制员那样用蓝墨水手写，旧值划掉留在条上。
const BAYS = [['needs-you', '需要你'], ['in-progress', '进行中'], ['done', '已有结果'], ['fyi', '知会']];
const meaning = { decide: '决定', input: '提供', act: '去做' };

export function mount(stage, model, kit) {
  const { esc, formatTime } = kit;
  const open = new Set();
  stage.innerHTML = '<div class="st-rack"></div>';
  const rack = stage.querySelector('.st-rack');
  rack.addEventListener('click', event => {
    const strip = event.target.closest('[data-open]');
    if (!strip) return;
    const id = strip.dataset.open;
    open.has(id) ? open.delete(id) : open.add(id);
    render(model.snapshot());
  });

  const short = at => `${Number(at.slice(8, 10))}日 ${formatTime(at)}`;
  const ink = text => `<span class="st-ink">${esc(text)}</span>`;
  function field(label, printed, before, changed) {
    return `<div class="st-f"><small>${label}</small>${changed && before != null ? `<s>${esc(before)}</s>${ink(printed)}` : `<span>${esc(printed)}</span>`}</div>`;
  }
  function strip(s, item, depth, changes) {
    const c = changes.get(item.id), f = new Set(c?.fields || []), before = c?.before || {};
    const ask = kit.currentAsk(s, item.id);
    const childAsk = (item.children?.items || []).some(child => kit.currentAsk(s, child.id));
    const src = item.sources?.at(-1);
    const due = item.due_at ? short(item.due_at) : '—';
    const oldShare = f.has('weight') && c.type === 'updated' && before.weight ? { critical: 24, high: 12, normal: 6, low: 3, trace: 1 }[before.weight] : null;
    const reply = ask ? `${(ask.meanings || []).map(m => meaning[m] || m).join('·')}${ask.actions.length > 1 ? ` · ${ask.actions.length}选1` : ''}` : childAsk ? '子项有问题' : '未登记';
    const kids = item.children?.items?.length || 0;
    const fresh = c?.type === 'added' || c?.type === 'restored';
    return `<div class="st-strip${depth ? ' is-child' : ''}${kids ? ' has-kids' : ''}${open.has(item.id) ? ' is-open' : ''}" ${kids ? `data-open="${esc(item.id)}"` : ''} style="--depth:${depth}">
      <div class="st-share"><b>${oldShare ? `<s>${oldShare}</s>${ink(item.share)}` : item.share}</b><i style="--w:${item.share / 64 * 100}%"></i><small>/64${depth ? ' 子层' : ''}</small></div>
      <div class="st-main">${f.has('title') && before.title ? `<s class="st-old">${esc(before.title)}</s>` : ''}<strong>${f.has('title') && before.title ? ink(item.title) : esc(item.title)}</strong>
        <p>${f.has('summary') && c.type === 'updated' ? ink(item.summary || '') : esc(item.summary || '')}</p></div>
      ${field('期限', due, before.due_at ? short(before.due_at) : '无', f.has('due_at') && c.type === 'updated')}
      <div class="st-f"><small>上次改动</small><span>${fresh || c ? ink('本轮') : kit.ago(item.since_update)}</span></div>
      <div class="st-f st-src"><small>来源</small><span>${src ? esc(`${src.channel}·${kit.author(src).split(' ')[0]}`) : '—'}</span><em>${item.sources?.length || 0} 条</em></div>
      <div class="st-f st-n"><small>子项</small><span>${kids ? `↳${kids}` : '—'}</span></div>
      <div class="st-f st-n"><small>批注</small><span>${item.annotations?.length ? `✎${item.annotations.length}` : '—'}</span></div>
      <div class="st-f st-reply"><small>回应</small><span class="${ask ? 'is-ask' : ''}">${reply}</span>${ask ? `<em>${esc(ask.prompt)}</em>` : ''}</div>
      ${fresh ? `<span class="st-stamp">${c.type === 'restored' ? '恢复' : '新'}</span>` : ''}
      ${f.has('kind') && c.type === 'updated' ? `<span class="st-moved">← 原在「${esc(kit.kindLabel[before.kind] || before.kind)}」</span>` : ''}
    </div>${open.has(item.id) ? `<div class="st-kids"><div class="st-kids-label">↳ ${esc(item.title)} 的子层 · 独立 64 份 · 已用 ${item.children.used}</div>${item.children.items.map(k => strip(s, k, depth + 1, changes)).join('')}</div>` : ''}`;
  }
  function render(s) {
    const changes = kit.changes(s), items = s.state.root.items;
    const marks = [...changes.values()].filter(c => c.type !== 'updated' || c.fields.some(x => x !== 'reason')).length;
    const gone = (s.frameDiff.changes || []).filter(c => c.type === 'withdrawn' || c.type === 'merged');
    rack.innerHTML = `<header class="st-head"><div><span class="st-kicker">条架 · ${esc(s.state.revision)}</span><h2>${esc(kit.dayTime(s.frame.at))}</h2></div>
      <div class="st-sum"><b>${s.state.root.used}</b>/64 份 · ${items.length} 张条<span class="st-legend">${ink('蓝墨水')} = 本轮改动 ${marks} 处　<s>划掉</s> = 旧值</span></div></header>
      ${BAYS.map(([kind, label]) => {
        const list = items.filter(i => i.kind === kind);
        return `<section class="st-bay"><h3><span>${label}</span><em>${list.length}</em></h3><div class="st-slot">${list.map(i => strip(s, i, 0, changes)).join('') || '<div class="st-empty">空槽</div>'}</div></section>`;
      }).join('')}
      ${s.state.root.used < 64 ? `<div class="st-free">未分配 ${64 - s.state.root.used} 份 · 留空的槽位</div>` : '<div class="st-free is-full">本层 64 份已满</div>'}
      ${gone.length ? `<section class="st-bay st-out"><h3><span>本轮取下</span><em>${gone.length}</em></h3><div class="st-slot">${gone.map(c => {
        const old = kit.getItem(s.previousState, c.item) || kit.getItem(s.state, c.item);
        const now = kit.getItem(s.state, c.item);
        return `<div class="st-strip is-gone"><div class="st-share"><b>${old?.share ?? '—'}</b></div><div class="st-main"><strong>${esc(old?.title || c.item)}</strong><p>${ink(c.type === 'merged' ? `并入「${kit.getItem(s.state, now?.merged_into)?.title || now?.merged_into}」` : `撤下：${now?.reason || ''}`)}</p></div></div>`;
      }).join('')}</div></section>` : ''}`;
    kit.side.innerHTML = '<p class="st-side">四个槽按条目自己的 <code>kind</code> 分；“回应”一栏另外写出是否登记了回应路径。点有子项的条，下面插出它的子层。</p>';
  }
  model.subscribe(s => render(s));
}
