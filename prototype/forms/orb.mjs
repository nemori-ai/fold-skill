// 06 环境球：不读字。色相只说“有没有登记了回应路径的事”，亮度说这些事合计占多少份，
// 呼吸只说“本轮新登记了问题”；底座 64 灯一灯一份。按一下才说出最大的那一件。
const WARM = '#ff7a2f', COOL = '#bfe3d2';

export function mount(stage, model, kit) {
  const { esc } = kit;
  let speaking = false;
  stage.innerHTML = `<div class="o-room"><div class="o-scene"><div class="o-glow"></div>
      <button class="o-orb" aria-label="按一下，说出最大的那件事"><span class="o-shine"></span></button>
      <svg class="o-base" viewBox="-220 -50 440 100" aria-hidden="true"></svg><div class="o-desk"></div>
      <p class="o-voice" hidden></p><p class="o-hint">按一下球，它只说最大的那一件</p></div>
    <aside class="o-decode"><h2>解码</h2><dl></dl><p class="o-small">颜色、亮度与呼吸各只承担一个含义；精确数字只在这块解码面板里出现。</p></aside>
    <section class="o-history"><h3>两周里这颗球的样子 <small>每格一帧 · 点格子跳到那一刻</small></h3><div class="o-strip"></div></section></div>`;
  const $ = s => stage.querySelector(s);

  function look(index) {
    const record = kit.records[index], ctx = { index, state: record.state };
    const asks = kit.activeItems(record.state).map(({ item }) => ({ item, ask: kit.currentAsk(ctx, item.id) })).filter(x => x.ask);
    const roots = new Set(asks.map(a => kit.rootOf(record.state, a.item.id)));
    const askShare = record.state.root.items.filter(i => roots.has(i.id)).reduce((n, i) => n + i.share, 0);
    const fresh = asks.filter(a => a.ask.frameIndex === index).length;
    return { record, asks, roots, askShare, fresh, warm: asks.length > 0, level: asks.length ? 0.25 + 0.75 * askShare / 64 : 0.18 };
  }
  stage.addEventListener('click', event => {
    const cell = event.target.closest('[data-go]');
    if (cell) { model.goFrame(Number(cell.dataset.go)); return; }
    if (!event.target.closest('.o-orb')) return;
    const s = model.snapshot(), v = look(s.index);
    const top = v.asks.sort((a, b) => b.item.share - a.item.share)[0];
    const line = top ? `${top.item.title}。${top.ask.prompt}` : s.state.root.items[0] ? `没有等你回应的事。最大的一件是：${s.state.root.items[0].title}。` : '现在什么都没有。';
    const voice = $('.o-voice');
    voice.textContent = `“${line}”`; voice.hidden = false;
    if ('speechSynthesis' in window && !speaking) {
      speaking = true; const u = new SpeechSynthesisUtterance(line); u.lang = 'zh-CN';
      u.onend = u.onerror = () => { speaking = false; }; speechSynthesis.speak(u);
    }
  });

  function render(s) {
    const v = look(s.index), color = v.warm ? WARM : COOL;
    const room = $('.o-room');
    room.style.setProperty('--c', color);
    room.style.setProperty('--b', v.level.toFixed(2));
    room.classList.toggle('is-breathing', v.fresh > 0);
    $('.o-voice').hidden = true;
    const ranked = s.state.root.items;
    const leds = [];
    for (const item of ranked) for (let i = 0; i < item.share; i += 1) leds.push(v.roots.has(item.id) ? 'warm' : 'on');
    while (leds.length < 64) leds.push('off');
    $('.o-base').innerHTML = `<ellipse rx="206" ry="36" class="o-rim"/>${leds.map((kind, i) => {
      const a = Math.PI / 2 + (i + 0.5) / 64 * Math.PI * 2;
      return `<circle cx="${(Math.cos(a) * 190).toFixed(1)}" cy="${(Math.sin(a) * 28).toFixed(1)}" r="4.2" class="is-${kind}"/>`;
    }).join('')}`;
    const rows = [
      ['色相', v.warm ? '暖橙' : '冷白', v.warm ? `有 ${v.asks.length} 个登记了回应路径的问题` : '没有等你回应的问题'],
      ['亮度', `${Math.round(v.level * 100)}%`, v.warm ? `这些问题所在的事项合计 ${v.askShare}/64 份` : '常亮最低档'],
      ['呼吸', v.fresh ? '呼吸中' : '静止', v.fresh ? `本轮新登记 ${v.fresh} 个问题` : '本轮没有新登记的问题'],
      ['底座', `${s.state.root.used} 灯亮`, `一灯一份；暖色 ${v.askShare} 灯，空 ${64 - s.state.root.used} 灯是未分配`],
    ];
    $('.o-decode dl').innerHTML = rows.map(([k, big, small]) => `<dt>${k}</dt><dd><b>${big}</b><span>${esc(small)}</span></dd>`).join('');
    $('.o-strip').innerHTML = kit.scenario.frames.map((f, i) => {
      const x = look(i);
      return `<button data-go="${i}" class="${i === s.index ? 'is-on' : ''}" title="${esc(`${kit.dayTime(f.at)} ${f.title}`)}" style="--c:${x.warm ? WARM : COOL};--b:${x.level.toFixed(2)}"><i></i>${x.fresh ? '<em></em>' : ''}<span>${Number(f.at.slice(8, 10))}</span></button>`;
    }).join('');
  }
  model.subscribe(s => render(s));
}
