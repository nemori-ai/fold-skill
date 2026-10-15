// 10 对话线程：每次整理是一条助理消息，状态是置顶附件。右侧是本人发给助理的话、
// 按钮反馈与批注（真实语料里是本人在来源处的回应）；快捷回复只在登记的问题仍有效时可点，点了只在本页演示。
const SHOW = 7;
const clip = text => ([...String(text || '')].length > 160 ? `${[...text].slice(0, 160).join('')}……` : text);

export function mount(stage, model, kit) {
  const { esc, records, scenario, formatTime } = kit;
  let more = 0, pinOpen = false;
  const local = new Map();
  stage.innerHTML = `<div class="ch-bg"><div class="ch-window">
      <header class="ch-top"><span class="ch-avatar">F</span><div><b>Fold 助理</b><small>替${esc(kit.personName)}整理工作与生活的事项</small></div></header>
      <div class="ch-pin"></div><div class="ch-stream" aria-live="polite"></div>
      <footer class="ch-compose"><input disabled placeholder="直接回复会作为批注交给 Agent（本页演示，不发送）"><button disabled>发送</button></footer></div></div>`;
  const $ = s => stage.querySelector(s);

  const verb = { added: '新增', restored: '恢复', withdrawn: '撤下', merged: '并入' };
  function changeLines(i) {
    const before = i ? records[i - 1].state : null, after = records[i].state;
    const title = id => kit.getItem(after, id)?.title || kit.getItem(before, id)?.title || id;
    const all = records[i].diff.changes.filter(c => c.type !== 'annotations_changed');
    const isRoot = c => !(kit.getItem(after, c.item) || kit.getItem(before, c.item))?.parent_id;
    const shown = [...all.filter(isRoot), ...all.filter(c => !isRoot(c))].slice(0, 4);
    const rest = all.length - shown.length;
    return shown.map(c => {
      const item = kit.getItem(after, c.item), old = before && kit.getItem(before, c.item);
      if (c.type === 'merged') return `<li><i>⇢</i>${esc(old?.title || c.item)} 并入「${esc(title(item?.merged_into))}」</li>`;
      if (c.type !== 'updated') return `<li><i>${c.type === 'withdrawn' ? '−' : '+'}</i>${verb[c.type]}「${esc(title(c.item))}」${c.type === 'withdrawn' && item?.reason ? `<small>${esc(item.reason)}</small>` : ''}</li>`;
      const share = c.fields.includes('share') ? ` ${c.before.share}→${c.after.share} 份` : '';
      const mark = c.fields.includes('share') ? (c.after.share > c.before.share ? '↑' : '↓') : '✎';
      const what = c.fields.includes('title') ? `「${esc(c.before.title)}」改为「${esc(c.after.title)}」` : `「${esc(item?.title || c.item)}」`;
      return `<li><i>${mark}</i>${what}${share}${item?.parent_id ? '<small>子项</small>' : ''}</li>`;
    }).concat(rest > 0 ? [`<li class="ch-rest"><i>⋯</i>另有 ${rest} 处改动（多为子项），见“状态”里的本轮变化</li>`] : []);
  }
  function asksOf(s, i) {
    return Object.entries(scenario.frames[i].asks || {}).map(([id, ask]) => {
      const item = kit.getItem(records[i].state, id);
      const live = kit.currentAsk(s, id);
      return { id, ask, item, live: live && live.frameIndex === i };
    }).filter(x => x.item);
  }
  function frameBlock(s, i) {
    const f = scenario.frames[i], rec = records[i];
    // The story writes the person's messages to the assistant as 用户消息 / 反馈; the real corpus has none, so
    // the person's own responses at the source (self events carrying feedback) stand in for them.
    const mine = f.events.filter(e => (e.from === scenario.persona?.name && (e.channel === '用户消息' || e.channel === '反馈')) || (e.self && e.feedback?.length));
    const reminders = f.events.filter(e => e.reminder);
    const others = f.events.filter(e => !mine.includes(e) && !e.reminder);
    const noise = others.filter(e => e.disposition !== 'used').length;
    const out = [];
    out.push(`<div class="ch-day">${esc(kit.dayTime(f.at))}</div>`);
    if (f.signal?.type === 'review') out.push(`<div class="ch-sys">${esc(f.signal.reason)} · 窗口内没有新消息 · ${esc(f.signal.coverage)}</div>`);
    else if (others.length) out.push(`<div class="ch-sys">收到 ${others.length} 条输入：${[...new Set(others.map(e => e.channel))].map(esc).join('、')}${noise ? ` · 其中 ${noise} 条噪音、重复或暂缓` : ''}</div>`);
    for (const e of mine) out.push(`<div class="ch-msg is-me"><div class="ch-bubble">${e.channel === '反馈' ? '<small>按钮反馈</small>' : e.self ? `<small>在 ${esc(e.channel)} 回应</small>` : ''}${esc(clip(e.text))}<time>${formatTime(e.at)}</time></div></div>`);
    for (const a of f.annotations || []) out.push(`<div class="ch-msg is-me"><div class="ch-bubble is-note"><small>批注 · 针对「${esc(kit.getItem(rec.state, a.item)?.title || a.item)}」</small>${esc(a.text)}<time>${formatTime(a.at)}</time></div></div>`);
    for (const e of reminders) out.push(`<div class="ch-sys is-clock">◷ ${esc(e.text)}</div>`);
    if (rec.receipt?.type === 'checked') {
      out.push(`<div class="ch-msg"><div class="ch-bubble is-quiet">检查过，状态没有变化。<time>${formatTime(f.at)}</time></div></div>`);
      return out.join('');
    }
    const asks = asksOf(s, i), lines = changeLines(i);
    const acked = rec.receipt?.acknowledges?.length ? `<p class="ch-ack">✓ 已在这次整理中处理你的 ${rec.receipt.acknowledges.length} 条批注</p>` : '';
    out.push(`<div class="ch-msg"><span class="ch-avatar is-small">F</span><div class="ch-bubble">
      <strong>${esc(f.title)}</strong><p>${esc(f.narrative)}</p>${lines.length ? `<ul class="ch-changes">${lines.join('')}</ul>` : ''}${acked}
      ${asks.map(({ id, ask, item, live }) => {
        const picked = local.get(`${id}|${i}`);
        return `<div class="ch-ask${live ? '' : ' is-stale'}"><small>${esc(item.title)} · ${item.share} 份${live ? '' : ' · 此问题已改写或过期'}</small><b>${esc(ask.prompt)}</b>
          <div class="ch-chips">${ask.actions.map(a => `<button data-reply="${esc(`${id}|${i}`)}" data-label="${esc(a.label)}" ${live && !picked ? '' : 'disabled'} class="${a.recommended ? 'is-rec' : ''}">${esc(a.label)}</button>`).join('')}</div></div>`;
      }).join('')}<time>${formatTime(f.at)}</time></div></div>`);
    for (const { id } of asks) { const picked = local.get(`${id}|${i}`); if (picked) out.push(`<div class="ch-msg is-me"><div class="ch-bubble is-local"><small>本页演示 · 不写回状态</small>${esc(picked)}</div></div>`); }
    return out.join('');
  }
  function render(s) {
    const items = s.state.root.items;
    $('.ch-pin').innerHTML = `<button class="ch-pin-bar" data-pin><b>置顶</b> 当前 ${s.state.root.used}/64 份：${items.slice(0, 3).map(i => `${esc(i.title)} <em>${i.share}</em>`).join(' · ')}${items.length > 3 ? ` · 另 ${items.length - 3} 件` : ''} · 未分配 ${64 - s.state.root.used}<span>${pinOpen ? '收起' : '展开'}</span></button>
      ${pinOpen ? `<ol class="ch-pin-list">${items.map(i => `<li><em>${i.share}</em>${esc(i.title)}<small>${esc(kit.kindLabel[i.kind])}</small></li>`).join('')}</ol>` : ''}`;
    const start = Math.max(1, s.index - SHOW - more + 1);
    const blocks = [];
    for (let i = start; i <= s.index; i += 1) blocks.push(frameBlock(s, i));
    const stream = $('.ch-stream');
    stream.innerHTML = `${start > 1 ? `<button class="ch-more" data-more>更早的 ${start - 1} 轮</button>` : '<div class="ch-sys">会话开始</div>'}${blocks.join('') || '<div class="ch-sys">还没有任何整理</div>'}`;
    stream.scrollTop = stream.scrollHeight;
    kit.side.innerHTML = '<p class="ch-side">助理消息的标题与正文读自回放数据里每一帧的 <code>title</code> 与 <code>narrative</code>；契约里的批次没有这样的说明字段，见 CONCEPTS.md 的“发现”。变化列表来自本帧的状态差异。</p>';
  }
  stage.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (!b) return;
    if ('pin' in b.dataset) { pinOpen = !pinOpen; render(model.snapshot()); }
    if ('more' in b.dataset) { more += SHOW; const keep = $('.ch-stream').scrollHeight; render(model.snapshot()); $('.ch-stream').scrollTop = $('.ch-stream').scrollHeight - keep; }
    if (b.dataset.reply) { local.set(b.dataset.reply, `你选了「${b.dataset.label}」`); kit.toast('本页演示：快捷回复不写回状态'); render(model.snapshot()); }
  });
  model.subscribe((s, info) => { if (info.type === 'frame') more = 0; render(s); });
}
