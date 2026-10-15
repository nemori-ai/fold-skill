import { createResponseStore, responseStatus, normalizeAsk, setTimeZone } from '../respond.mjs';

// 01 腕上一瞥：抬腕两秒，只回答“要不要现在掏手机”。
// 表盘只数要紧的问题：24 小时内到期（含已过期）或档位为 critical / high；其余问题只记一个“可以晚点”的数。
// 表圈 64 格，一格一份，按排名顺时针点亮；朱红只给登记了回应路径的事项，要紧的最亮。
// 表上只承载 confirm 与二选一的 choose；批准、回复、定时间都交给手机。点按只在本页演示，不写回状态：
// 先“已保存”，推进到下一轮整理后变为“已收到”，可以撤回。
const HOUR = 3600000, DAY = 86400000;
const WEIGHT_RANK = { critical: 0, high: 1, normal: 2, low: 3, trace: 4 };
const EASE = 'cubic-bezier(.2,.75,.25,1)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const span = ms => { const abs = Math.abs(ms); return abs < HOUR ? `${Math.max(1, Math.round(abs / 60000))} 分钟` : abs < 2 * DAY ? `${Math.round(abs / HOUR)} 小时` : `${Math.round(abs / DAY)} 天`; };
const chars = text => [...String(text || '')];
/** ≤16 characters for the wrist: the dataset's `short` when it has one, else the clause after the last colon, else a cut. */
export function shortAsk(ask, item) {
  if (ask.short) return ask.short;
  const prompt = String(ask.prompt || item?.title || '').trim();
  if (chars(prompt).length <= 16) return prompt;
  const tail = prompt.split(/[：:]/).at(-1).trim();
  if (tail && chars(tail).length <= 16 && chars(tail).length >= 4) return tail;
  return `${chars(prompt).slice(0, 15).join('')}…`;
}

export function mount(stage, model, kit) {
  const { esc, formatTime, formatDate } = kit;
  setTimeZone(kit.scenario.timeZone || 'Asia/Shanghai');
  const store = createResponseStore();
  let front = 0, s = model.snapshot(), lastIndex = -1, lastCount = null;

  stage.innerHTML = `<div class="w-wrap">
    <p class="w-lede"><b class="w-lede-q">要不要现在掏手机？</b><span class="w-lede-a"></span></p>
    <div class="w-row">
      <figure class="w-fig"><div class="w-case"><button type="button" class="w-screen w-face" data-w="face" aria-label="表盘"><svg class="w-ring" viewBox="-130 -130 260 260" aria-hidden="true"></svg><div class="w-center"></div><span class="w-pulse" aria-hidden="true"></span></button></div>
        <figcaption><b>抬腕</b><span class="w-cap-face"></span><span class="w-haptic"></span></figcaption></figure>
      <figure class="w-fig"><div class="w-case"><div class="w-screen w-stack" tabindex="0" aria-label="要紧的问题，按上下键翻"></div><button type="button" class="w-crown" data-w="crown" aria-label="转表冠：下一张"></button></div>
        <figcaption><b>转表冠</b><span class="w-cap-stack"></span><span class="w-crown-hint"><kbd>↑</kbd><kbd>↓</kbd> 或滚轮翻张 <button type="button" class="w-next" data-w="crown">下一张 ↓</button></span></figcaption></figure>
      <figure class="w-fig"><div class="w-case"><div class="w-screen w-reply" aria-live="polite"></div></div>
        <figcaption><b>点开</b><span class="w-cap-reply">表上只答“是/否”和二选一；批准、回复、定时间交给手机。按下只在本页演示，不写回状态。</span></figcaption></figure>
    </div>
    <p class="w-keys"></p></div>`;
  const $ = selector => stage.querySelector(selector);
  const ring = $('.w-ring');
  ring.innerHTML = Array.from({ length: 64 }, (_, i) => {
    const a = (i + 0.5) / 64 * Math.PI * 2 - Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
    return `<line data-i="${i}" x1="${(c * 106).toFixed(1)}" y1="${(sn * 106).toFixed(1)}" x2="${(c * 122).toFixed(1)}" y2="${(sn * 122).toFixed(1)}"/>`;
  }).join('');
  const ticks = [...ring.children];

  // ---------- what counts ----------
  const dueOf = (item, ask) => { const v = ask?.due_at || (item.kind !== 'done' ? item.due_at : null); const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
  const isUrgent = ({ item, ask }) => { const due = dueOf(item, ask); return (due != null && due - s.cursor < DAY) || (WEIGHT_RANK[item.weight] ?? 2) <= 1; };
  function urgencyKey({ item, ask }) { const due = dueOf(item, ask); return [WEIGHT_RANK[item.weight] ?? 2, due != null && due - s.cursor < DAY ? 0 : 1, due ?? Infinity, -item.share]; }
  const byUrgency = (a, b) => { const x = urgencyKey(a), y = urgencyKey(b); for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };
  /** Answerable on the wrist: confirm, or a choose/confirm with exactly two buttons that are decisions or actions. */
  function wristChoices(ask) {
    const n = normalizeAsk(ask), choices = n.actions.filter(a => a.meaning === 'decide' || a.meaning === 'act');
    if (n.expects === 'confirm' && choices.length >= 1 && choices.length <= 2) return choices;
    if (n.expects === 'choose' && choices.length === 2) return choices;
    return null;
  }
  const phoneReason = ask => ({ approve: '批准合并要看改动', reply: '要写一句', schedule: '要选时间', defer: '要选推到哪天', choose: '选项不止两个' })[normalizeAsk(ask).expects] || '要在手机上答';
  const recordOf = item => store.forItem(item, s.cursor);
  const answered = item => { const r = recordOf(item); return r && r.meaning !== 'snooze' ? r : null; };
  const snoozed = item => { const r = recordOf(item); return r?.meaning === 'snooze' && r.until > s.cursor; };
  function compose() {
    const all = kit.asks(s).filter(x => !snoozed(x.item)).sort(byUrgency);
    const urgent = all.filter(isUrgent), later = all.filter(x => !isUrgent(x));
    const waiting = urgent.filter(x => !answered(x.item));
    return { all, urgent, later, waiting };
  }
  function dueWords(item, ask) {
    const due = dueOf(item, ask);
    if (due == null) return (WEIGHT_RANK[item.weight] ?? 2) <= 1 ? { text: item.weight === 'critical' ? '档位关键' : '档位高', hot: false } : null;
    const ms = due - s.cursor;
    return ms < 0 ? { text: `已过 ${span(ms)}`, hot: true } : { text: `${formatTime(due)} 前 · 还有 ${span(ms)}`, hot: ms < DAY };
  }

  // ---------- face ----------
  function renderFace(v) {
    const askRoots = new Map();
    for (const x of v.all) { const root = kit.rootOf(s.state, x.item.id); const level = isUrgent(x) ? (answered(x.item) ? 'done' : 'hot') : 'ask'; if (askRoots.get(root) !== 'hot') askRoots.set(root, level); }
    let i = 0;
    for (const item of s.state.root.items) {
      const level = askRoots.get(item.id);
      for (let n = 0; n < item.share && i < 64; n += 1, i += 1) ticks[i].setAttribute('class', `${level ? `is-${level}` : 'is-item'}${n === 0 ? ' is-first' : ''}`);
    }
    for (; i < 64; i += 1) ticks[i].setAttribute('class', 'is-blank');
    const top = v.waiting[0];
    const count = v.waiting.length;
    const d = top && dueWords(top.item, top.ask);
    $('.w-center').innerHTML = `<div class="w-time">${formatTime(s.cursor)}</div>
      <div class="w-count ${count ? '' : 'is-zero'}"><span>${count}</span></div>
      <div class="w-unit">${count ? '件要紧' : v.urgent.length ? '要紧的都答了' : '没有要紧的事'}</div>
      ${top ? `<div class="w-comp">${d ? `<em class="${d.hot ? 'is-hot' : ''}">${esc(d.text)}</em>` : ''}<span>${esc(shortAsk(top.ask, top.item))}</span></div>` : `<div class="w-comp is-calm">${v.later.length ? `${v.later.length} 个问题可以晚点` : '状态里没有开着的问题'}</div>`}`;
    $('.w-face').setAttribute('aria-label', count ? `${count} 件要紧，最急：${shortAsk(top.ask, top.item)}` : '没有要紧的事');
    if (lastCount != null && lastCount !== count && !reduced()) {
      const down = count < lastCount;
      $('.w-count span').animate([{ transform: `translateY(${down ? 34 : -34}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: EASE });
    }
    lastCount = count;
    $('.w-lede-a').textContent = count ? `要。${count} 件要紧，最急的是“${shortAsk(top.ask, top.item)}”。` : v.all.length ? `不用。${v.all.length} 个问题都可以晚点在手机上看。` : '不用。此刻没有开着的问题。';
    $('.w-lede').classList.toggle('is-yes', Boolean(count));
    $('.w-cap-face').textContent = `表圈 64 格，一格一份，按排名顺时针点亮；亮朱红是要紧的问题，暗朱红是可以晚点的问题。中间的数只数要紧的：24 小时内到期或档位高。此刻开着 ${v.all.length} 个问题，${v.urgent.length} 件要紧。`;
  }

  // ---------- stack ----------
  function cardHTML(x, at, total) {
    if (!x) return '';
    const { item, ask } = x, d = dueWords(item, ask), r = answered(item), wrist = wristChoices(ask);
    return `<div class="w-card${r ? ' is-done' : ''}" data-id="${esc(item.id)}">
      <div class="w-card-top">${d ? `<span class="w-due${d.hot ? ' is-hot' : ''}">${esc(d.text)}</span>` : '<span></span>'}<span class="w-pos">${at + 1}/${total}</span></div>
      <strong>${esc(shortAsk(ask, item))}</strong>
      <em>${esc(item.title)}</em>
      <small class="w-where ${wrist ? 'is-wrist' : 'is-phone'}">${r ? `✓ ${esc(r.label)} · 已${responseStatus(r, s.frames, s.cursor).status === 'acknowledged' ? '收到' : '保存'}` : wrist ? '表上可答 →' : `到手机上答 · ${esc(phoneReason(ask))}`}</small>
      ${r ? '<span class="w-stamp" aria-hidden="true">✓</span>' : ''}</div>`;
  }
  function stackHTML(v) {
    const day = formatDate(s.cursor);
    const head = `<div class="w-top"><span>${day}</span><span>${formatTime(s.cursor)}</span></div>`;
    if (!v.urgent.length) {
      return `${head}<div class="w-card is-calm"><div class="w-card-top"><span class="w-due is-calm">不用掏手机</span><span></span></div><strong>${v.later.length ? `${v.later.length} 个问题可以晚点` : '没有开着的问题'}</strong><em>${v.later.length ? '都不急：没有 24 小时内到期、也没有高档位的问题' : '状态里的事都只需知道'}</em><small class="w-where">回到手机上再看</small></div>`;
    }
    const n = v.urgent.length, at = ((front % n) + n) % n;
    const rest = n - 1;
    return `${head}<div class="w-deck">${cardHTML(v.urgent[at], at, n)}${rest > 0 ? '<div class="w-peek"></div>' : ''}${rest > 1 ? '<div class="w-peek is-2"></div>' : ''}</div>
      <div class="w-more">${v.later.length ? `另有 ${v.later.length} 个可以晚点` : rest ? `还有 ${rest} 张` : '只有这一张'}</div>`;
  }

  // ---------- reply ----------
  function replyHTML(v) {
    if (!v.urgent.length) return `<div class="w-calm"><div class="w-ok" aria-hidden="true">✓</div><p>此刻没有要紧的事</p><small>${v.later.length ? `${v.later.length} 个问题都可以晚点在手机上看` : '没有开着的问题'}</small></div>`;
    const n = v.urgent.length, { item, ask } = v.urgent[((front % n) + n) % n];
    const r = answered(item);
    if (r) {
      const { status, at } = responseStatus(r, s.frames, s.cursor);
      return `<div class="w-done is-${status}"><svg class="w-tick" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27l7 7 15-16"/></svg><p>你选了「${esc(r.label)}」</p><small>${status === 'acknowledged' ? `已收到 · Agent 在 ${formatTime(at)} 的整理中读到` : '已保存 · 等 Agent 下一轮整理'}</small><button type="button" class="w-undo" data-w="undo" data-id="${esc(item.id)}">撤回</button></div>`;
    }
    const wrist = wristChoices(ask), d = dueWords(item, ask);
    const head = `${d ? `<p class="w-reply-due${d.hot ? ' is-hot' : ''}">${esc(d.text)}</p>` : ''}<p class="w-prompt">${esc(shortAsk(ask, item))}</p>`;
    if (!wrist) {
      return `${head}<div class="w-phone"><span class="w-phone-icon" aria-hidden="true">▯</span><p>这件在手机上答</p><small>${esc(phoneReason(ask))}</small></div>
        <div class="w-actions"><button type="button" class="is-handoff" data-w="handoff" data-id="${esc(item.id)}">在手机上打开</button><button type="button" class="is-quiet" data-w="snooze" data-id="${esc(item.id)}">1 小时后再提醒</button></div>`;
    }
    return `${head}<div class="w-actions">${wrist.map((a, i) => `<button type="button" class="${a.recommended || (wrist.length === 1) ? 'is-rec' : i === 0 && !wrist.some(b => b.recommended) ? 'is-rec' : ''}" data-w="act" data-id="${esc(item.id)}" data-act="${esc(a.id)}">${esc(a.label)}</button>`).join('')}<button type="button" class="is-quiet" data-w="snooze" data-id="${esc(item.id)}">1 小时后再提醒</button></div>`;
  }

  // ---------- render & motion ----------
  function render({ deck = 0 } = {}) {
    s = model.snapshot();
    const v = compose();
    renderFace(v);
    const stack = $('.w-stack'), reply = $('.w-reply');
    const oldCard = stack.querySelector('.w-card');
    const oldId = oldCard?.dataset.id, oldHTML = oldCard?.outerHTML;
    stack.innerHTML = stackHTML(v);
    const card = stack.querySelector('.w-card');
    const focusInReply = reply.contains(document.activeElement) ? document.activeElement.dataset.w : null;
    const before = reply.innerHTML;
    reply.innerHTML = replyHTML(v);
    if (focusInReply) (reply.querySelector(`[data-w="${focusInReply}"]`) || reply.querySelector('button'))?.focus({ preventScroll: true });
    if (!reduced() && card) {
      if (deck && oldId && oldId !== card.dataset.id) {
        // Turning the crown: the old card leaves upward, the next rises from the peek.
        const ghost = document.createElement('div');
        ghost.innerHTML = oldHTML;
        const g = ghost.firstElementChild;
        g.classList.add('w-card-ghost');
        stack.querySelector('.w-deck').append(g);
        g.animate([{ transform: 'none', opacity: 1 }, { transform: `translateY(${deck > 0 ? -34 : 34}px) scale(.94)`, opacity: 0 }], { duration: 260, easing: EASE }).onfinish = () => g.remove();
        card.animate([{ transform: `translateY(${deck > 0 ? 22 : -22}px) scale(.95)`, opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: EASE });
      } else if (oldId && oldId !== card.dataset.id) card.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: EASE });
      else if (oldHTML && oldHTML !== card.outerHTML) card.querySelectorAll('.w-where, .w-due, .w-stamp').forEach(el => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 }));
    }
    if (!reduced() && before !== reply.innerHTML) {
      const done = reply.querySelector('.w-done');
      if (done && !before.includes('w-done')) {
        done.querySelector('.w-tick')?.classList.add('is-drawing');
        done.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE });
      } else reply.firstElementChild?.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE });
    }
    $('.w-keys').textContent = s.playing ? '▶ 播放中，每 5.6 秒一轮整理 · 空格暂停' : '← → 换整理时刻 · 空格 播放 · ↑ ↓ 翻张 · Enter 到按钮、再按作答';
    $('.w-keys').classList.toggle('is-playing', Boolean(s.playing));
    $('.w-next').hidden = v.urgent.length < 2;
    $('.w-crown').disabled = v.urgent.length < 2;
    $('.w-cap-stack').textContent = v.urgent.length ? `只叠要紧的 ${v.urgent.length} 件，最急的在最前${v.later.length ? `；其余 ${v.later.length} 个问题只记一个数，留给手机` : ''}。` : `没有要紧的问题。${v.later.length ? `${v.later.length} 个问题都可以晚点。` : ''}`;
    renderSide(v);
  }
  function renderSide(v) {
    const items = [...s.state.root.items];
    const hot = new Set(v.urgent.map(x => kit.rootOf(s.state, x.item.id))), asked = new Set(v.all.map(x => kit.rootOf(s.state, x.item.id)));
    const shown = items.filter((item, i) => i < 8 || hot.has(item.id));
    const hidden = items.filter(item => !shown.includes(item));
    kit.side.innerHTML = `<h3 class="w-legend-title">要紧的问题（表盘上的数）</h3>
      <ol class="w-legend is-asks">${v.urgent.map(({ item, ask }) => `<li><span class="is-hot">${chars(shortAsk(ask, item)).length}</span>${esc(shortAsk(ask, item))}<small>${esc(item.title)}</small></li>`).join('') || '<li><span>0</span>此刻没有</li>'}</ol>
      <p class="w-legend-note">规则：24 小时内到期（含已过期）或档位 critical / high。左边数字是短问法的字数（≤16）。可以晚点的 ${v.later.length} 个问题不上表盘。</p>
      <h3 class="w-legend-title">表圈刻度，顺时针</h3>
      <ol class="w-legend">${shown.map(i => `<li><span class="${hot.has(i.id) ? 'is-hot' : asked.has(i.id) ? 'is-ask' : ''}">${i.share}</span>${esc(i.title)}</li>`).join('')}${hidden.length ? `<li><span class="is-blank">${hidden.reduce((n, i) => n + i.share, 0)}</span>其余 ${hidden.length} 件</li>` : ''}${s.state.root.used < 64 ? `<li><span class="is-blank">${64 - s.state.root.used}</span>未分配</li>` : ''}</ol>`;
  }
  function pulse(fresh) {
    const cap = $('.w-haptic');
    cap.textContent = fresh ? `触感：轻敲 ${fresh} 下 · 本轮新登记 ${fresh} 个要紧的问题` : '触感：无 · 本轮没有新的要紧问题';
    if (!fresh || reduced()) return;
    const ring$ = $('.w-pulse');
    ring$.animate(Array.from({ length: fresh * 2 + 1 }, (_, i) => ({ opacity: i % 2 ? 1 : 0, transform: i % 2 ? 'scale(1)' : 'scale(.97)' })), { duration: 260 * fresh + 200, easing: 'ease-out' });
  }
  function turn(step) {
    const v = compose();
    if (v.urgent.length < 2) return;
    front += step;
    render({ deck: step });
  }

  stage.addEventListener('click', event => {
    const b = event.target.closest('[data-w]');
    if (!b) return;
    const kind = b.dataset.w;
    if (kind === 'crown') { turn(1); return; }
    if (kind === 'face') { $('.w-stack').focus({ preventScroll: true }); $('.w-stack').animate([{ boxShadow: '0 0 0 3px #ff5a36' }, { boxShadow: '0 0 0 0 #ff5a3600' }], { duration: 600 }); return; }
    const item = kit.getItem(s.state, b.dataset.id);
    if (!item) return;
    const ask = kit.currentAsk(s, item.id);
    if (kind === 'undo') { store.remove(item); kit.toast('已撤回'); render(); return; }
    if (kind === 'handoff') { kit.toast('本页演示：手机上会直接打开这张卡'); return; }
    if (kind === 'snooze') { store.save(item, { id: 'snooze', label: '稍后提醒', meaning: 'snooze' }, { ask, at: s.cursor, until: s.cursor + HOUR }); kit.toast(`${formatTime(s.cursor + HOUR)} 再提醒 · 本页演示`); render(); return; }
    if (kind === 'act') {
      const action = normalizeAsk(ask).actions.find(a => a.id === b.dataset.act);
      store.save(item, action, { ask, at: s.cursor });
      kit.toast('已保存 · 本页演示，不写回状态');
      render();
    }
  });
  const stackEl = $('.w-stack');
  stackEl.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); turn(1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); turn(-1); }
  });
  let wheelAt = 0;
  stackEl.addEventListener('wheel', event => { event.preventDefault(); const now = performance.now(); if (now - wheelAt < 280 || Math.abs(event.deltaY) < 4) return; wheelAt = now; turn(event.deltaY > 0 ? 1 : -1); }, { passive: false });
  const onKey = event => {
    if (event.target.matches('input, textarea, select, [contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === ' ' && !event.target.closest('button, a, summary')) { event.preventDefault(); model.togglePlay(); }
    // Nothing focused yet: Enter jumps to the reply screen's first button (focus only; a second Enter answers).
    if (event.key === 'Enter' && (event.target === document.body || event.target === document.documentElement)) { const first = $('.w-reply button'); if (first) { event.preventDefault(); first.focus(); } }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !stackEl.contains(event.target) && !event.target.closest('.fs-inspector')) { event.preventDefault(); turn(event.key === 'ArrowDown' ? 1 : -1); }
  };
  document.addEventListener('keydown', onKey);

  model.subscribe((next, info) => {
    s = next;
    const turned = info.type === 'frame' && next.index !== lastIndex;
    if (turned || info.type === 'init') front = 0;
    render();
    if (turned && lastIndex >= 0) pulse(compose().urgent.filter(x => x.ask.frameIndex === next.index).length);
    else if (info.type === 'init') pulse(0);
    lastIndex = next.index;
  });
}
