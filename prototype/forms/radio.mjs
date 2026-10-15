// 02 晨间朗读：份额 = 播报秒数。每份 1.5 秒，64 份上限 96 秒；未分配的份额不占用时间。
// 默认按时间轴模拟播放；勾选“朗读”后用浏览器 SpeechSynthesis 逐句读出。
const SECONDS_PER_SHARE = 1.5;
const clip = (text, n) => ([...text].length > n ? `${[...text].slice(0, n).join('')}……` : text);
const clock = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function mount(stage, model, kit) {
  const { esc, formatTime, formatDate } = kit;
  const canSpeak = 'speechSynthesis' in window;
  let script = null, pos = Number(new URLSearchParams(location.search).get('pos')) || 0, timer = null, speaking = false, expanded = new Set();
  stage.innerHTML = `<div class="r-wrap"><section class="r-deck">
      <div class="r-head"><div><div class="r-kicker">FOLD 晨间朗读</div><h2 class="r-date"></h2></div>
        <div class="r-clock"><b class="r-now">00:00</b><span class="r-total"></span></div></div>
      <div class="r-bar" aria-label="播报时间轴，段长等于份额"></div><div class="r-scale"></div>
      <div class="r-controls"><button data-r="prev" aria-label="上一件">⏮</button><button data-r="play" class="r-play">▶ 播放</button><button data-r="next" aria-label="下一件">⏭ 下一件</button>
        <button data-r="expand">展开这一件</button><button data-r="later">稍后再说</button>
        <label class="r-speak"><input type="checkbox" ${canSpeak ? '' : 'disabled'}> 用浏览器朗读${canSpeak ? '' : '（不支持）'}</label></div>
    </section><article class="r-script" aria-live="off"></article></div>`;
  const $ = s => stage.querySelector(s);

  function build(s) {
    const items = s.state.root.items, asks = new Map(kit.asks(s).map(a => [a.item.id, a.ask]));
    const askCount = asks.size, signal = s.frame.signal;
    const lead = s.index === 0 ? ['现在还没有任何需要记住的事。']
      : [`${formatDate(s.frame.at)} ${formatTime(s.frame.at)}，Fold 为你整理。`,
        signal?.type === 'review' ? `这是${signal.reason}，窗口内没有新消息${signal.coverage ? `；${signal.coverage}` : ''}。` : `这一轮收到 ${s.frame.events.length} 条输入。`,
        `${askCount ? `有 ${askCount} 个问题等你回应，` : '没有等你回应的问题，'}一共 ${items.length} 件事，占 ${s.state.root.used} 份。`];
    const blocks = items.map((item, rank) => {
      const ask = asks.get(item.id), childAsk = (item.children?.items || []).map(c => [c, asks.get(c.id)]).find(([, a]) => a);
      const kind = ask ? '等你回应' : kit.kindLabel[item.kind];
      const parts = [`第${rank + 1}件，${kind}：${item.title}。`];
      if (item.share >= 6 && item.summary) parts.push(item.summary);
      if (item.due_at && item.kind !== 'done' && item.share >= 6) parts.push(`期限是${formatDate(item.due_at)} ${formatTime(item.due_at)}，${kit.until(Date.parse(item.due_at) - s.cursor)}。`);
      if (item.share >= 12 && ask) parts.push(`需要你回答：${ask.prompt}可以说：${ask.actions.map(a => a.label).join('，或者')}。`);
      else if (item.share >= 12 && childAsk) parts.push(`它的子项里有一个问题：${childAsk[1].prompt}`);
      const source = item.sources?.at(-1);
      if (item.share >= 24 && source) parts.push(`依据${kit.author(source)}在${source.channel}里说：${clip(source.quote || '', 38)}`);
      return { item, parts, budget: item.share * SECONDS_PER_SHARE };
    });
    const used = s.state.root.used * SECONDS_PER_SHARE;
    const tail = [`以上。${s.state.root.used < 64 ? `还有 ${64 - s.state.root.used} 份没有分配，不占用你的时间。` : '本层 64 份已经用满。'}`];
    // Time axis: lead and tail sit outside the budget; each item fills exactly its share.
    const sentences = [];
    const LEAD = 6, TAIL = 3;
    lead.forEach((text, i) => sentences.push({ text, start: i * LEAD / lead.length, end: (i + 1) * LEAD / lead.length, block: -1 }));
    let t = LEAD;
    blocks.forEach((b, bi) => {
      const weight = b.parts.reduce((n, p) => n + [...p].length, 0);
      b.start = t;
      for (const text of b.parts) { const d = b.budget * [...text].length / weight; sentences.push({ text, start: t, end: t + d, block: bi }); t += d; }
      b.end = t;
    });
    sentences.push({ text: tail[0], start: t, end: t + TAIL, block: -2 });
    return { blocks, sentences, lead: LEAD, total: t + TAIL, used, max: LEAD + 64 * SECONDS_PER_SHARE + TAIL };
  }

  const current = () => script.sentences.findIndex(x => pos >= x.start && pos < x.end);
  function paint() {
    const idx = Math.max(0, current() === -1 ? script.sentences.length - 1 : current());
    const block = script.sentences[idx].block;
    stage.querySelectorAll('[data-sentence]').forEach(el => el.classList.toggle('is-on', Number(el.dataset.sentence) === idx));
    stage.querySelectorAll('[data-block]').forEach(el => el.classList.toggle('is-on', Number(el.dataset.block) === block));
    $('.r-now').textContent = clock(pos);
    $('.r-bar').style.setProperty('--played', `${Math.min(100, Math.max(0, (pos - script.lead) / (64 * SECONDS_PER_SHARE) * 100))}%`);
    $('.r-play').textContent = timer || speaking ? '⏸ 暂停' : '▶ 播放';
  }
  function render(s) {
    stop();
    script = build(s);
    if (pos > script.total) pos = 0;
    const { blocks } = script;
    $('.r-date').textContent = `${formatDate(s.frame.at)} ${formatTime(s.frame.at)} · ${s.frame.id}`;
    $('.r-total').textContent = `/ ${clock(script.total)} · 上限 ${clock(script.max)}`;
    $('.r-bar').innerHTML = `${blocks.map((b, i) => `<button data-block="${i}" data-seek="${b.start}" style="flex:${b.item.share}" title="${esc(b.item.title)} · ${b.item.share} 份 = ${b.budget} 秒"><span>${b.item.share >= 6 ? esc(clip(b.item.title, b.item.share >= 12 ? 14 : 5)) : ''}</span><small>${b.item.share}</small></button>`).join('')}${s.state.root.used < 64 ? `<div class="r-blank" style="flex:${64 - s.state.root.used}"><span>未分配 ${64 - s.state.root.used} 份 · 不占时间</span></div>` : ''}`;
    $('.r-scale').innerHTML = Array.from({ length: 9 }, (_, i) => `<span>${i * 12} 秒</span>`).join('');
    const sentence = (x, i) => `<span data-sentence="${i}" data-seek="${x.start}">${esc(x.text)}</span>`;
    const all = script.sentences.map((x, i) => ({ ...x, i }));
    $('.r-script').innerHTML = `<p class="r-lead">${all.filter(x => x.block === -1).map(x => sentence(x, x.i)).join('')}</p>
      ${blocks.map((b, bi) => `<section class="r-item" data-block="${bi}"><aside><b>${b.item.share}</b><span>份</span><small>${b.budget} 秒</small></aside>
        <p>${all.filter(x => x.block === bi).map(x => sentence(x, x.i)).join('')}</p>
        ${expanded.has(b.item.id) ? `<div class="r-expand">${(b.item.children?.items || []).map(c => `<div>↳ ${esc(c.title)}<small>${c.share}/64 子层</small></div>`).join('') || '<div>没有子项。</div>'}${(b.item.sources || []).map(src => `<blockquote>${esc(kit.author(src))} · ${esc(src.channel)}：${esc(src.quote || '')}</blockquote>`).join('')}<small>展开内容不计入播报预算</small></div>` : ''}</section>`).join('')}
      <p class="r-tail">${all.filter(x => x.block === -2).map(x => sentence(x, x.i)).join('')}</p>`;
    kit.side.innerHTML = `<h3 class="r-side-title">可以插话</h3><ul class="r-side"><li><b>“下一件”</b>跳到下一件的标题</li><li><b>“展开”</b>读子项与原文，不占预算</li><li><b>“稍后”</b>提醒设定交给宿主，本页不写回</li><li><b>“选第一个”</b>回应登记过的问题，本页只演示</li></ul><p class="r-side-note">旁白里的时间与件数读自状态；标题照原文朗读，不另起名。</p>`;
    paint();
  }
  function stop() { clearInterval(timer); timer = null; if (speaking) { speechSynthesis.cancel(); speaking = false; } }
  function speakFrom(i) {
    if (i >= script.sentences.length) { stop(); paint(); return; }
    pos = script.sentences[i].start; paint();
    const u = new SpeechSynthesisUtterance(script.sentences[i].text);
    u.lang = 'zh-CN'; u.rate = 1.05;
    u.onend = () => { if (speaking) speakFrom(i + 1); };
    speechSynthesis.speak(u);
  }
  function play() {
    if (timer || speaking) { stop(); paint(); return; }
    if (pos >= script.total - 0.1) pos = 0;
    if ($('.r-speak input').checked) { speaking = true; speakFrom(Math.max(0, current())); return; }
    timer = setInterval(() => { pos += 0.25; if (pos >= script.total) { pos = script.total; stop(); } paint(); }, 250);
    paint();
  }
  function seek(t) { const wasPlaying = timer || speaking; stop(); pos = t; paint(); if (wasPlaying) play(); }
  stage.addEventListener('click', event => {
    const el = event.target.closest('[data-seek],[data-r]');
    if (!el) return;
    if (el.dataset.seek) { seek(Number(el.dataset.seek)); return; }
    const blockNow = script.sentences[Math.max(0, current())]?.block ?? -1;
    const starts = script.blocks.map(b => b.start);
    if (el.dataset.r === 'play') play();
    if (el.dataset.r === 'next') seek(starts.find(t => t > pos + 0.01) ?? script.total - 3);
    if (el.dataset.r === 'prev') seek([...starts].reverse().find(t => t < pos - 1) ?? 0);
    if (el.dataset.r === 'expand' && blockNow >= 0) { const id = script.blocks[blockNow].item.id; expanded.has(id) ? expanded.delete(id) : expanded.add(id); const keep = pos; render(model.snapshot()); pos = keep; paint(); }
    if (el.dataset.r === 'later') kit.toast('本页演示：稍后提醒交给宿主，不写回状态');
  });
  model.subscribe((s, info) => { if (info.type === 'frame') { pos = 0; expanded = new Set(); } render(s); });
}
