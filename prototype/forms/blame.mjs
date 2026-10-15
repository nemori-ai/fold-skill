// 09 出处栏：状态写成一份等宽文档，每一行左栏写出“这一行最后一次被改动”的那一轮：
// 多久前、哪一帧、那一轮相关的输入来自谁。色带越新越亮。逐字段回溯回放记录，不做推断。
const HEAT = ['#f0883e', '#f5a467', '#f8bf8f', '#fad6b6', '#fce8d8', '#fdf3ea'];
const LIMITS = [3, 12, 24, 72, 168, Infinity]; // hours

export function mount(stage, model, kit) {
  const { esc, records, scenario } = kit;
  let picked = 0;
  stage.innerHTML = '<div class="bl-wrap"><header class="bl-head"></header><div class="bl-doc" role="table"></div></div>';
  const $ = s => stage.querySelector(s);

  function blame(id, fields, upto) {
    for (let i = upto; i >= 0; i -= 1) {
      const change = records[i].diff.changes.find(c => c.item === id && (c.type === 'added' || c.type === 'restored' || c.type === 'merged' || c.fields.some(f => fields.includes(f))));
      if (change) return { index: i, change };
    }
    return null;
  }
  function linesFor(s) {
    const lines = [];
    for (const { item, depth } of kit.activeItems(s.state)) {
      const pad = '  '.repeat(depth), ask = kit.currentAsk(s, item.id);
      const add = (text, cls, fields, hostIndex) => lines.push({ item, text, cls, fields, depth, b: hostIndex != null ? { index: Math.max(0, hostIndex), host: true } : blame(item.id, fields, s.index) ?? { index: 0 } });
      add(`${pad}${'#'.repeat(depth + 2)} ${item.title}`, 'is-h', ['title']);
      if (item.summary) add(`${pad}${item.summary}`, 'is-p', ['summary']);
      add(`${pad}- 份额 ${item.share}/64 · ${kit.kindLabel[item.kind]}${item.due_at ? ` · 期限 ${kit.dayTime(item.due_at)}` : ''}`, 'is-meta', ['weight', 'share', 'kind', 'due_at']);
      if (depth === 0 && item.sources?.length) add(`${pad}- 依据 ${item.sources.length} 条，最新：${item.sources.at(-1).channel} · ${kit.author(item.sources.at(-1))}`, 'is-meta', ['sources']);
      if (ask) add(`${pad}- 登记的问题：${ask.prompt}［${ask.actions.map(a => a.label).join(' | ')}］`, 'is-ask', [], ask.frameIndex);
      for (const id of item.annotations || []) {
        const a = s.state.annotations.find(x => x.id === id);
        if (a) add(`${pad}> ${a.author}：${a.text}（${a.status === 'acknowledged' ? `已纳入 ${a.acknowledged_revision}` : '等待处理确认'}）`, 'is-note', [], kit.frameOf(a.created_at));
      }
    }
    return lines;
  }
  const heat = hours => HEAT[LIMITS.findIndex(limit => hours < limit)];
  function gutter(s, line) {
    const f = scenario.frames[line.b.index], hours = (s.cursor - Date.parse(f.at)) / 3600000;
    const ev = f.events.find(e => e.disposition === 'used' && (e.relatedIds || []).includes(line.item.id)) || f.events.find(e => e.disposition === 'used');
    return { color: heat(hours), age: hours < 1 / 60 ? '本轮' : kit.ago(hours * 3600), frame: f.id, who: line.b.host ? '宿主记录' : ev ? `${ev.channel} · ${ev.from.split(' ')[0]}` : f.signal?.type === 'review' ? '定时整理' : '—' };
  }
  function detail(s, line) {
    const f = scenario.frames[line.b.index], change = line.b.change;
    const related = f.events.filter(e => (e.relatedIds || []).includes(line.item.id) || (e.feedback || []).some(x => x.target === line.item.id));
    const fmt = v => (v == null ? '无' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    kit.side.innerHTML = `<h3 class="bl-side-title">这一行的出处</h3><p class="bl-side-frame"><b>${esc(f.id)}</b> · ${esc(kit.dayTime(f.at))}<br>${esc(f.title)}</p>
      ${line.b.host ? '<p class="bl-side-small">来自宿主一侧的记录（登记的问题或批注），不在状态的业务字段里。</p>' : change ? `<div class="bl-side-change"><small>${{ added: '新增', restored: '恢复', updated: '改动', merged: '合并' }[change.type] || change.type}</small>${(change.fields || []).filter(x => line.fields.includes(x)).map(x => `<div><code>${x}</code> ${esc(fmt(change.before?.[x]))} → <b>${esc(fmt(change.after?.[x]))}</b></div>`).join('')}</div>` : ''}
      ${related.length ? `<h4>那一轮相关的输入</h4>${related.map(e => `<blockquote><small>${esc(e.channel)} · ${esc(e.from)} · ${kit.formatTime(e.at)}</small>${esc(e.text)}</blockquote>`).join('')}` : '<p class="bl-side-small">那一轮没有直接关联到这件事的输入。</p>'}`;
  }
  stage.addEventListener('click', event => {
    const row = event.target.closest('[data-line]');
    if (!row) return;
    picked = Number(row.dataset.line);
    stage.querySelectorAll('[data-line]').forEach(r => r.classList.toggle('is-picked', Number(r.dataset.line) === picked));
    detail(model.snapshot(), current[picked]);
  });
  let current = [];
  function render(s, info) {
    if (info?.type === 'frame') picked = 0;
    current = linesFor(s);
    let last = null;
    $('.bl-head').innerHTML = `<div class="bl-path">state / root · <b>${esc(s.state.revision)}</b> · ${esc(kit.dayTime(s.frame.at))} · ${current.length} 行</div>
      <div class="bl-key">更早 ${HEAT.slice().reverse().map(c => `<i style="background:${c}"></i>`).join('')} 更新<span>色带 = 这一行最后一次被改动距此刻多久</span></div>`;
    $('.bl-doc').innerHTML = current.map((line, i) => {
      const g = gutter(s, line), key = `${line.b.index}|${line.item.id}`, first = key !== last;
      last = key;
      return `<div class="bl-line ${line.cls}${first ? ' is-first' : ''}${i === picked ? ' is-picked' : ''}" data-line="${i}" role="row">
        <span class="bl-heat" style="background:${g.color}"></span>
        <span class="bl-age">${first ? esc(g.age) : ''}</span><span class="bl-frame">${first ? esc(g.frame) : ''}</span><span class="bl-who">${first ? esc(g.who) : ''}</span>
        <span class="bl-no">${i + 1}</span><code>${esc(line.text)}</code></div>`;
    }).join('') || '<div class="bl-empty">空状态：还没有任何事项，也就没有出处。</div>';
    if (current[picked]) detail(s, current[picked]);
    else kit.side.innerHTML = '';
  }
  model.subscribe((s, info) => render(s, info));
}
