import { escapeHTML as esc, formatDate, formatTime, kindLabel, getItem, colorFor, findEvent, currentAsk, feedbackTrail, scenario } from './shared.mjs?v=feedback-loop-1';

// D · 手机首页。Height is attention (one share = one row unit); the registered
// feedback control is the expectation. Feedback given here stays in this view:
// it is a local demonstration of the loop and never writes back to Fold state.
const UNIT = 10;
const STACK_PEEKS = 4;
const meaningLabel = { decide: '需要你决定', input: '需要你提供', act: '需要你去做', know: '只需知道' };
const surfaces = scenario.feedback.surfaces;

const day = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' });
const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'short' });
const clock = value => formatTime(value);
function relative(ms) {
  const abs = Math.abs(ms), h = Math.round(abs / 3600000), d = Math.round(abs / 86400000);
  const text = abs < 3600000 ? `${Math.max(1, Math.round(abs / 60000))} 分钟` : abs < 172800000 ? `${h} 小时` : `${d} 天`;
  return ms >= 0 ? `还有 ${text}` : `已过 ${text}`;
}
const versionKey = item => `${item.id}|${item.updated_at}`;
const avatarOf = (item, state) => {
  const author = (item.sources || []).map(source => source.author).find(name => name && !['林苒', '宿主'].includes(name)) || scenario.categories[item.id]?.label || item.title;
  return { glyph: author.replace(/^[^\p{Script=Han}A-Za-z]+/u, '').slice(0, 1) || '·', color: colorFor(item, state), name: author };
};
const avatarHTML = (item, state, size = '') => { const a = avatarOf(item, state); return `<span class="d-avatar ${size}" style="--tone:${a.color}" title="${esc(a.name)}">${esc(a.glyph)}</span>`; };

export function mount(host, model) {
  let s = model.snapshot(), surface = new URLSearchParams(location.search).get('surface') === 'inbox' ? 'inbox' : 'focus';
  let stackOpen = false, sheet = null, disposed = false, lastIndex = s.index;
  const local = new Map(); // versionKey -> { meaning, label, value, at }
  const detailStack = [];

  host.innerHTML = `<div class="d-stage">
    <aside class="d-rail" aria-label="回放与读法">
      <div class="d-rail-brand">Fold <span>手机首页</span></div>
      <div class="d-rail-time"><span class="d-rail-date"></span><h1 class="d-rail-title"></h1><p class="d-rail-signal"></p></div>
      <div class="d-rail-steps"><button data-d="prev" aria-label="上一轮">‹</button><input class="d-rail-range" type="range" min="0" step="1" aria-label="选择整理时刻"><button data-d="next" aria-label="下一轮">›</button></div>
      <p class="d-rail-narrative"></p>
      <section class="d-rail-block"><h2>这块屏幕的用途</h2><div class="d-surface-toggle" role="radiogroup" aria-label="业务用途">${surfaces.map(x => `<button role="radio" data-surface="${x.id}">${esc(x.label)}</button>`).join('')}</div><p class="d-surface-policy"></p></section>
      <section class="d-rail-block"><h2>比较起点</h2><label class="d-base">上次看到 <select class="d-base-select" aria-label="比较起点"></select></label><p class="d-small">首切片不记录查看，这里由你指定；产品需要新增查看记录才能自动给出。</p></section>
      <section class="d-rail-block d-legend"><h2>读法</h2><ol>
        <li><b>高度 = 份额</b>一份约一行，满屏约 64 份。</li>
        <li><b>按钮 = 期待</b><span class="d-chip-demo is-fill">选项</span>决定 <span class="d-chip-demo">¥ 输入</span>提供 <span class="d-chip-demo">我已处理</span>去做；没有按钮就是只需知道。</li>
        <li><b>纸边 = 子项</b>卡片下的薄边是这件事的内部厚度。</li>
        <li><b>错开的一叠 = 只需知道</b>最多露 4 张，其余记作 +x，不参与批量签收。</li>
      </ol></section>
      <p class="d-small">在这里点按的反馈只留在本页演示，不写回状态。故事里真实发生的回复与按钮，标为 ↩。<button class="d-link" data-d="reset">清除本页反馈</button></p>
    </aside>
    <div class="d-device"><div class="d-phone"><div class="d-screen" tabindex="-1">
      <div class="d-statusbar"><span class="d-status-time"></span><span class="d-island"></span><span class="d-status-icons" aria-hidden="true">●●● ◗ ▭</span></div>
      <div class="d-scroll">
        <header class="d-head"><div class="d-head-main"><div class="d-date"></div><button class="d-snoozed" data-d="snoozed" hidden></button></div><div class="d-head-sub"><button class="d-surface-chip" data-d="surface"></button><span class="d-since"></span></div><p class="d-signal" hidden></p></header>
        <main class="d-cards" aria-label="此刻的关注"></main>
        <section class="d-known" aria-label="只需知道"></section>
        <div class="d-blank" aria-hidden="true"></div>
        <div class="d-read-shelf"></div>
      </div>
      <button class="d-fold" data-d="fold" aria-label="查看被折叠的输入与历史"><span class="d-fold-tex" aria-hidden="true"></span><span class="d-fold-text"></span><span class="d-fold-more"></span></button>
      <section class="d-detail" aria-label="事项详情" hidden></section>
      <div class="d-sheet-backdrop" hidden></div><section class="d-sheet" aria-label="操作" hidden></section>
      <div class="d-toast" role="status" aria-live="polite"></div>
    </div></div></div>
  </div>`;
  const $ = selector => host.querySelector(selector);
  const screen = $('.d-screen');

  // ---------- feedback (local only) ----------
  const fbFor = item => { const f = local.get(versionKey(item)); return f && f.at <= s.cursor ? f : null; };
  function give(item, action, value) {
    const f = { meaning: action.meaning, label: action.label, id: action.id, value, at: s.cursor, until: action.until };
    local.set(versionKey(item), f);
    const verb = { decide: () => `已选择「${action.label}」`, input: () => `已提交「${value ?? action.label}」`, act: () => `已报告「${action.label}」`, ack: () => '已阅', snooze: () => `${clock(action.until)} 再提醒` }[action.meaning]();
    toast(`${verb} · 交给 Agent 下一轮整理`);
    render();
  }
  function undo(item) { local.delete(versionKey(item)); render(); }
  function snoozedItems() {
    const out = [];
    const walk = layer => { for (const item of layer?.items || []) { const f = fbFor(item); if (f?.meaning === 'snooze' && f.until > s.cursor) out.push({ item, f }); walk(item.children); } };
    walk(s.state.root); return out;
  }
  function woke(item) { const f = fbFor(item); return f?.meaning === 'snooze' && f.until <= s.cursor ? f : null; }
  function storyReminder(item) {
    return s.frame.events.find(event => event.reminder?.target === item.id);
  }

  // ---------- data shaping ----------
  const changes = () => new Map((s.diff.changes || []).map(change => [change.item, change]));
  function changeMark(item, map) {
    const own = map.get(item.id);
    if (own?.type === 'added' || own?.type === 'restored') return '<span class="d-mark is-new">新</span>';
    if (own && (own.fields || []).some(f => f !== 'reason')) return '<span class="d-mark">变</span>';
    const childChanged = (item.children?.items || []).some(child => map.has(child.id));
    return childChanged ? '<span class="d-mark is-soft">子项有变</span>' : '';
  }
  const expectation = item => { const a = currentAsk(s, item.id); return a ? a.expects[0] : 'know'; };
  function dueText(item) {
    if (item.due_at && item.kind !== 'done') return `${clock(item.due_at)} ${relative(Date.parse(item.due_at) - s.cursor)}`;
    if (item.until_stale != null && item.until_stale < 0) return '资料待复核';
    return '';
  }

  // ---------- controls ----------
  function controlsHTML(item, { compact = false, inDetail = false } = {}) {
    const ask = currentAsk(s, item.id), f = fbFor(item), reminder = woke(item);
    if (f && f.meaning !== 'ack' && f.meaning !== 'snooze') {
      return `<div class="d-receipt"><span class="d-check">✓</span><span>${f.meaning === 'input' ? `已提交 ${esc(f.value)}` : `你${f.meaning === 'act' ? '报告' : '选了'}「${esc(f.label)}」`} · ${clock(f.at)}<small>等 Agent 下一轮整理；状态尚未改变</small></span><button class="d-link" data-undo="${esc(item.id)}">撤回</button></div>`;
    }
    if (f?.meaning === 'ack') return `<div class="d-acked">你已知道 · ${clock(f.at)}${surface === 'focus' ? '<small>近期重点仍保留它</small>' : ''}<button class="d-link" data-undo="${esc(item.id)}">撤回</button></div>`;
    void reminder;
    if (!ask) {
      if (compact) return item.kind === 'done' ? `<button class="d-quiet" data-ack="${esc(item.id)}">收下</button>` : '';
      const label = item.kind === 'done' ? '收下' : '知道了';
      return item.kind === 'in-progress' && !inDetail ? '' : `<div class="d-actions is-quiet"><button class="d-quiet" data-ack="${esc(item.id)}">${label}</button>${inDetail ? snoozeButton(item) : ''}</div>`;
    }
    if (compact) {
      const first = ask.actions[0];
      const hint = first.meaning === 'decide' ? `${ask.actions.length} 选 1` : first.meaning === 'input' ? (first.input.type === 'photo' ? '📷 拍一张' : first.input.type === 'money' ? '¥ 填写' : '填写') : first.label;
      return `<button class="d-compact ${first.meaning === 'decide' ? 'is-decide' : ''}" data-open-actions="${esc(item.id)}">${esc(hint)}<span aria-hidden="true">›</span></button>`;
    }
    const buttons = ask.actions.map(action => {
      if (action.meaning === 'input') {
        if (action.input.type === 'photo') return `<button class="d-btn is-line" data-act="${esc(item.id)}:${action.id}">📷 ${esc(action.label)}</button>`;
        const money = action.input.type === 'money';
        return `<form class="d-input" data-input="${esc(item.id)}:${action.id}">${money ? '<span>¥</span>' : ''}<input name="v" ${money ? 'inputmode="numeric"' : ''} aria-label="${esc(action.label)}" value="${money ? esc(String(action.input.prefill ?? '')) : ''}" placeholder="${esc(action.input.placeholder || action.label)}"><button class="d-btn is-fill">${esc(action.input.submit || '提交')}</button></form>`;
      }
      const fill = action.recommended || (ask.actions.length === 1 && action.meaning === 'act');
      return `<button class="d-btn ${fill ? 'is-fill' : 'is-line'}" data-act="${esc(item.id)}:${action.id}">${esc(action.label)}${action.recommended ? '<small>推荐</small>' : ''}</button>`;
    }).join('');
    return `<div class="d-actions">${buttons}${snoozeButton(item)}</div>`;
  }
  const snoozeButton = item => `<button class="d-snooze" data-snooze="${esc(item.id)}" aria-label="稍后提醒">◷<span>稍后</span></button>`;

  // ---------- cards ----------
  function cardHTML(item, marks) {
    const share = item.share, size = share >= 24 ? 'xl' : share >= 12 ? 'l' : share >= 6 ? 'm' : 's';
    const f = fbFor(item), exp = expectation(item), reminder = storyReminder(item), wokeF = woke(item);
    const kids = item.children?.items || [];
    const edges = kids.length ? `<span class="d-edges" style="--n:${Math.min(3, kids.length)}" aria-hidden="true"></span>` : '';
    const due = dueText(item);
    const story = feedbackTrail(s, item.id).filter(t => t.frameIndex === s.index && t.links.length).at(-1);
    const banner = reminder ? `<p class="d-banner">◷ 你${formatDate(reminder.reminder.requested_at)} ${clock(reminder.reminder.requested_at)} 让我 ${clock(reminder.at)} 提醒 · 已按现在的情况重看</p>`
      : wokeF ? `<p class="d-banner">◷ 你 ${clock(wokeF.at)} 让我此时提醒 · ${Date.parse(item.updated_at) > wokeF.at ? '期间有更新' : '期间没有新变化'}</p>`
      : story ? `<p class="d-banner is-story">↩ 回应你 ${clock(story.event.at)} 的${story.links[0].via === 'button' ? '选择' : '回复'}</p>` : '';
    const meta = [exp !== 'know' ? `<span class="d-exp">${meaningLabel[exp]}</span>` : `<span>${kindLabel[item.kind]}</span>`, due && `<span class="${item.due_at && Date.parse(item.due_at) < s.cursor ? 'is-late' : ''}">${esc(due)}</span>`, kids.length && `<span>内含 ${kids.length} 件</span>`].filter(Boolean).join('<i>·</i>');
    const evidence = size === 'xl' && item.sources?.length ? (() => { const src = [...item.sources].reverse().find(x => x.author !== '林苒') || item.sources.at(-1); return `<blockquote class="d-evidence"><span class="d-avatar is-sm" style="--tone:${colorFor(item, s.state)}">${esc((src.author || '·').slice(0, 1))}</span><span><b>${esc(src.author)}</b>${esc(src.quote)}</span></blockquote>`; })() : '';
    const calm = f?.meaning === 'ack' ? ' is-calm' : '';
    const body = size === 'm' || size === 's'
      ? `<div class="d-row">${avatarHTML(item, s.state, 'is-sm')}<div class="d-row-text"><h3>${esc(item.title)}${marks}</h3><p class="d-meta">${meta}</p></div>${controlsHTML(item, { compact: true })}</div>`
      : `<div class="d-card-top">${avatarHTML(item, s.state)}<p class="d-meta">${meta}</p>${marks}</div><h3>${esc(item.title)}</h3>${size === 'xl' || !currentAsk(s, item.id) ? `<p class="d-summary">${esc(item.summary)}</p>` : ''}${evidence}${controlsHTML(item)}`;
    return `<article class="d-card is-${size} is-${item.kind}${calm}${banner ? ' has-banner' : ''}" data-id="${esc(item.id)}" style="--h:${share * UNIT}px" tabindex="0" aria-label="${esc(item.title)}，${share} 份">${banner}${body}${edges}</article>`;
  }

  function knownHTML(items, marks) {
    if (!items.length) return '';
    const ordered = [...items].sort((a, b) => Number(Boolean(fbFor(a))) - Number(Boolean(fbFor(b))) || a.rank - b.rank);
    const unread = ordered.filter(item => !fbFor(item));
    const visible = ordered.slice(0, STACK_PEEKS), extra = ordered.length - visible.length;
    const visibleUnread = visible.filter(item => !fbFor(item));
    if (stackOpen) {
      return `<div class="d-known-head"><span>只需知道 · ${items.length}</span><button class="d-link" data-d="stack">收起</button></div><ul class="d-known-list">${ordered.map(item => `<li class="${fbFor(item) ? 'is-done' : ''}" data-id="${esc(item.id)}">${avatarHTML(item, s.state, 'is-sm')}<span class="d-known-title">${esc(item.title)}${marks.get(item.id) || ''}</span>${fbFor(item) ? '<span class="d-tick">✓</span>' : `<button class="d-quiet" data-ack="${esc(item.id)}">知道了</button>`}</li>`).join('')}</ul>${unread.length > 1 ? `<button class="d-ack-all" data-ack-many="${esc(unread.map(i => i.id).join(','))}">这 ${unread.length} 件都知道了</button>` : ''}`;
    }
    const [top, ...rest] = visible;
    return `<div class="d-known-head"><span>只需知道 · ${items.length}</span>${visibleUnread.length > 1 ? `<button class="d-link" data-ack-many="${esc(visibleUnread.map(i => i.id).join(','))}">露出的 ${visibleUnread.length} 件都知道了</button>` : ''}</div>
      <div class="d-stack" data-d="stack" style="--peeks:${rest.length}">
        <div class="d-stack-top${fbFor(top) ? ' is-done' : ''}" data-swipe="${esc(top.id)}" data-id="${esc(top.id)}">${avatarHTML(top, s.state)}<span class="d-known-title">${esc(top.title)}${marks.get(top.id) || ''}</span>${fbFor(top) ? '<span class="d-tick">✓</span>' : `<button class="d-quiet" data-ack="${esc(top.id)}">← 知道了</button>`}</div>
        ${rest.map((item, i) => `<div class="d-peek${fbFor(item) ? ' is-done' : ''}" style="--i:${i + 1}">${avatarHTML(item, s.state, 'is-xs')}<span>${esc(scenario.categories[item.id]?.label || item.title.slice(0, 6))}</span></div>`).join('')}
        ${extra > 0 ? `<span class="d-plus" title="没露出的事项不参与批量签收">+${extra}</span>` : ''}
      </div>`;
  }

  // ---------- render ----------
  function render() {
    if (disposed) return;
    const flip = new Map([...host.querySelectorAll('.d-card[data-id]')].map(el => [el.dataset.id, el.getBoundingClientRect().top]));
    const map = changes();
    const items = [...(s.state.root.items || [])].sort((a, b) => a.rank - b.rank);
    const snoozed = new Set(snoozedItems().map(x => x.item.id));
    const readOut = [], known = [], cards = [];
    for (const item of items) {
      if (snoozed.has(item.id)) continue;
      const f = fbFor(item);
      if (surface === 'inbox' && f?.meaning === 'ack') { readOut.push(item); continue; }
      // A reminder you asked for comes back as its own row, whatever its share.
      const recalled = storyReminder(item) || woke(item);
      if (item.share <= 3 && !currentAsk(s, item.id) && item.kind !== 'needs-you' && !recalled) known.push(item); else cards.push(item);
    }
    const marks = new Map(items.map(item => [item.id, changeMark(item, map)]));
    $('.d-cards').innerHTML = cards.length ? cards.map(item => cardHTML(item, marks.get(item.id))).join('') : `<div class="d-empty"><p>这里还空着</p><span>${s.frame.phase === 'initial' ? '还没有收到第一条需要记住的消息。' : '当前没有占位的事项。'}</span></div>`;
    $('.d-known').innerHTML = knownHTML(known, marks);
    const blank = s.state.root.budget - s.state.root.used;
    $('.d-blank').style.height = `${blank * UNIT}px`;
    $('.d-blank').dataset.label = blank > 0 ? `还空着 ${blank} 份` : '';
    $('.d-read-shelf').innerHTML = readOut.length ? `<p>通知中心里已阅 ${readOut.length} 条，已不占位：${readOut.map(item => `<button class="d-link" data-undo="${esc(item.id)}">${esc(item.title.slice(0, 10))}</button>`).join('、')}</p>` : '';

    const at = new Date(s.cursor);
    $('.d-status-time').textContent = clock(at);
    $('.d-date').innerHTML = `${esc(day.format(at))}<span>${esc(weekday.format(at))}</span>`;
    const sz = snoozedItems();
    $('.d-snoozed').hidden = !sz.length;
    $('.d-snoozed').innerHTML = sz.length ? `◷ ${clock(Math.min(...sz.map(x => x.f.until)))} 再提醒 ${sz.length} 件` : '';
    $('.d-surface-chip').textContent = `${surfaces.find(x => x.id === surface).label} ▾`;
    const changed = (s.diff.changes || []).length;
    $('.d-since').textContent = s.index === s.baseIndex ? '起点' : `自 ${formatDate(s.frames[s.baseIndex].at)} ${clock(s.frames[s.baseIndex].at)} · ${changed ? `${changed} 处变化` : '没有变化'}`;
    const signal = s.frame.signal;
    const sig = $('.d-signal');
    sig.hidden = !(signal && signal.type === 'review');
    if (signal?.type === 'review') sig.textContent = `${signal.reason} · ${clock(signal.window.from)} 起收到 0 条 · ${signal.coverage} · ${s.records[s.index].receipt.type === 'checked' ? '检查后不改' : '按时间重看后有调整'}`;

    // fold band: real counts only
    const total = s.frames.slice(0, s.index + 1).reduce((n, f) => n + f.events.length, 0);
    const kinds = s.frame.events.reduce((m, e) => (m[e.disposition] = (m[e.disposition] || 0) + 1, m), {});
    const gone = (s.state.historical || []).length;
    $('.d-fold-text').innerHTML = `<b>累计 ${total} 条输入 → 现在 ${items.length} 件</b><small>本轮 ${s.frame.events.length} 条${kinds.noise ? ` · 噪音 ${kinds.noise}` : ''}${kinds.duplicate ? ` · 重复 ${kinds.duplicate}` : ''}${gone ? ` · 撤下或合并 ${gone}` : ''}</small>`;
    $('.d-fold-more').textContent = '›';

    // rail
    $('.d-rail-date').textContent = `${formatDate(s.frame.at)} ${clock(s.frame.at)} · ${s.index + 1}/${s.frames.length}`;
    $('.d-rail-title').textContent = s.frame.title;
    $('.d-rail-narrative').textContent = s.frame.narrative;
    $('.d-rail-signal').textContent = signal ? (signal.type === 'review' ? `调用原因：${signal.reason}，窗口内 0 条事件` : `调用原因：${signal.reason || `收到 ${signal.received} 条输入`}`) : '初始状态';
    const range = $('.d-rail-range'); range.max = s.frames.length - 1; range.value = s.index;
    host.querySelectorAll('[data-surface]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.surface === surface)));
    $('.d-surface-policy').textContent = surfaces.find(x => x.id === surface).policy;
    const base = $('.d-base-select');
    base.innerHTML = s.frames.slice(0, s.index + 1).map((f, i) => `<option value="${i}" ${i === s.baseIndex ? 'selected' : ''}>${formatDate(f.at)} ${clock(f.at)}${i === s.index - 1 ? '（上一轮）' : ''}</option>`).join('');

    renderDetail();
    // FLIP: same items glide to their new place
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) host.querySelectorAll('.d-card[data-id]').forEach(el => {
      const before = flip.get(el.dataset.id); if (before == null) { el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.3,.7,.2,1)' }); return; }
      const dy = before - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.42,0,.28,1)' });
    });
  }

  // ---------- detail ----------
  function historyOf(id) {
    const out = [];
    s.records.slice(0, s.index + 1).forEach((record, i) => {
      const change = (record.diff?.changes || []).find(c => c.item === id);
      if (change) out.push({ i, at: s.frames[i].at, type: change.type, title: change.after?.title || change.before?.title || getItem(record.state || {}, id)?.title });
    });
    return out;
  }
  const step = (h, now = false) => `<li class="${now === true ? 'is-now' : ''}"><time>${formatDate(h.at)} ${clock(h.at)}</time><span>${esc(h.title || '')}${h.type === 'added' ? '（纳入）' : ''}</span></li>`;
  function renderDetail() {
    const panel = $('.d-detail');
    const id = s.selectedId, item = id && getItem(s.state, id);
    if (!item) { panel.hidden = true; panel.innerHTML = ''; return; }
    const ask = currentAsk(s, item.id);
    const history = historyOf(item.id);
    const trail = feedbackTrail(s, item.id);
    const anns = (s.state.annotations || []).filter(a => a.item === item.id || item.annotations?.includes(a.id));
    const parent = item.parent_id && getItem(s.state, item.parent_id);
    panel.hidden = false;
    panel.innerHTML = `<div class="d-detail-bar"><button data-d="back" aria-label="返回">‹</button><span>${esc(parent ? parent.title : scenario.categories[item.id]?.label || '事项')}</span><span class="d-detail-share">${item.share} / 64 份</span></div>
      <div class="d-detail-body">
        <p class="d-meta">${ask ? `<span class="d-exp">${meaningLabel[ask.expects[0]]}</span>` : `<span>${kindLabel[item.kind]}</span>`}${dueText(item) ? `<i>·</i><span>${esc(dueText(item))}</span>` : ''}</p>
        <h2>${esc(item.title)}</h2>
        ${ask?.prompt ? `<p class="d-prompt">${esc(ask.prompt)}</p>` : ''}
        <p class="d-detail-summary">${esc(item.summary)}</p>
        ${item.reason ? `<section><h4>为什么是这个分量</h4><p>${esc(item.reason)}</p></section>` : ''}
        ${item.sources?.length ? `<section><h4>依据</h4>${item.sources.map(src => { const e = src.ref?.startsWith('event:') ? findEvent(src.ref.slice(6)) : null; const pub = e?.publicSourceId && scenario.publicSources.find(p => p.id === e.publicSourceId); return `<article class="d-source"><span class="d-avatar is-sm" style="--tone:${colorFor(item, s.state)}">${esc((src.author || '·').slice(0, 1))}</span><div><small>${esc(src.author || '')} · ${esc(src.channel)} · ${e ? `${formatDate(e.at)} ${clock(e.at)}` : ''}</small><p>${esc(src.quote)}</p>${pub ? `<a href="${esc(pub.url)}" target="_blank" rel="noreferrer">${esc(pub.title)} ↗</a>` : ''}</div></article>`; }).join('')}</section>` : ''}
        ${history.length ? `<section><h4>来龙去脉 · ${history.length} 次整理</h4>${history.length > 5 ? `<details class="d-earlier"><summary>更早 ${history.length - 4} 次</summary><ol class="d-timeline">${history.slice(0, -4).map(step).join('')}</ol></details>` : ''}<ol class="d-timeline">${history.slice(history.length > 5 ? -4 : 0).map((h, n, list) => step(h, n === list.length - 1)).join('')}</ol></section>` : ''}
        ${trail.length || anns.length ? `<section><h4>反馈回路</h4>${trail.map(t => `<p class="d-loop">↩ <time>${formatDate(t.event.at)} ${clock(t.event.at)}</time> ${esc(t.event.text)}${t.links[0] ? `<small>${{ decide: '回应决定', input: '提供输入', act: '报告已处理', ack: '已阅', snooze: '稍后提醒' }[t.links[0].meaning]} · ${t.links[0].via === 'button' ? '登记的按钮' : '回复消息'}</small>` : t.event.reminder ? '<small>到点提醒 · 关联原反馈</small>' : ''}</p>`).join('')}${anns.map(a => `<p class="d-loop">✎ ${esc(a.text)}<small>批注 · ${a.status === 'acknowledged' ? 'Agent 已纳入整理' : '已保存，等待处理确认'}</small></p>`).join('')}</section>` : ''}
        ${item.children?.items?.length ? `<section><h4>内含 ${item.children.items.length} 件 · 独立 64 份</h4><div class="d-children">${[...item.children.items].sort((a, b) => a.rank - b.rank).map(child => `<button data-open="${esc(child.id)}" style="--h:${Math.max(44, child.share * 4)}px"><span>${esc(child.title)}</span><small>${currentAsk(s, child.id) ? meaningLabel[currentAsk(s, child.id).expects[0]] : kindLabel[child.kind]} · ${child.share} 份</small></button>`).join('')}</div></section>` : ''}
        <button class="d-link d-json" data-lab-inspect="state">核对完整状态 JSON ↗</button>
      </div>
      <div class="d-detail-actions">${controlsHTML(item, { inDetail: true })}</div>`;
  }

  // ---------- sheets ----------
  function openSheet(html) { sheet = true; $('.d-sheet').innerHTML = `<div class="d-sheet-grip"></div>${html}`; $('.d-sheet').hidden = false; $('.d-sheet-backdrop').hidden = false; }
  function closeSheet() { sheet = null; $('.d-sheet').hidden = true; $('.d-sheet-backdrop').hidden = true; }
  function snoozeSheet(item) {
    const now = s.cursor, hour = 3600000;
    const options = [['1 小时后', now + hour], ['2 小时后', now + 2 * hour], ['明早 09:00', nextMorning(now)]];
    openSheet(`<h3>什么时候再提醒？</h3><p class="d-small">「${esc(item.title)}」<br>稍后提醒不是已阅，也不改原截止时间。到点后按那时的情况重看。</p><div class="d-sheet-options">${options.map(([label, t]) => `<button data-snooze-at="${esc(item.id)}:${t}">${label}<small>${formatDate(t)} ${clock(t)}</small></button>`).join('')}</div>`);
  }
  function nextMorning(t) { const d = new Date(t + 8 * 3600000); d.setUTCHours(9, 0, 0, 0); let m = d.getTime() - 8 * 3600000; if (m <= t) m += 86400000; return m; }
  function foldSheet() {
    const labels = { used: '采用', duplicate: '重复', noise: '噪音', deferred: '暂缓' };
    const hist = s.state.historical || [];
    openSheet(`<h3>折在下面的</h3><p class="d-small">本轮 ${s.frame.events.length} 条输入，全部保留；份额只给值得关注的事项。</p><ul class="d-fold-list">${s.frame.events.map(e => `<li><small>${esc(e.channel)} · ${esc(e.from)} · ${clock(e.at)}<b>${labels[e.disposition] || e.disposition}</b></small><p>${esc(e.text)}</p></li>`).join('') || '<li><p>这一轮没有新输入。</p></li>'}</ul>${hist.length ? `<h4>已撤下或合并 ${hist.length} 件</h4><ul class="d-fold-list">${hist.map(h => `<li><small>${h.status === 'merged' ? '已合并' : '已撤下'}</small><p>${esc(h.title)}</p></li>`).join('')}</ul>` : ''}<div class="d-sheet-links"><button data-lab-inspect="inputs">原始输入 ↗</button><button data-lab-inspect="batch">声明与回执 ↗</button><button data-lab-inspect="diff">变化对比 ↗</button></div>`);
  }
  function actionsSheet(item) { openSheet(`<h3>${esc(item.title)}</h3>${currentAsk(s, item.id)?.prompt ? `<p class="d-small">${esc(currentAsk(s, item.id).prompt)}</p>` : ''}${controlsHTML(item, { inDetail: true })}<button class="d-link" data-open="${esc(item.id)}">看详情 ›</button>`); }

  let toastTimer = null;
  function toast(text) { const t = $('.d-toast'); t.textContent = text; t.classList.add('is-on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), 2200); }

  // ---------- events ----------
  const findAny = id => getItem(s.state, id);
  function flyToChip(id) {
    const card = host.querySelector(`.d-card[data-id="${CSS.escape(id)}"]`), chip = $('.d-snoozed');
    if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const a = card.getBoundingClientRect(), b = $('.d-head').getBoundingClientRect();
    const ghost = card.cloneNode(true); ghost.classList.add('d-ghost');
    Object.assign(ghost.style, { position: 'fixed', left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`, margin: 0 });
    document.body.append(ghost);
    ghost.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${b.right - a.left - 120}px, ${b.top - a.top}px) scale(.25)`, opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.5,0,.2,1)' }).onfinish = () => ghost.remove();
    void chip;
  }
  host.addEventListener('click', event => {
    const t = event.target.closest('button, [data-d], .d-card, .d-known-list li, .d-sheet-backdrop');
    if (!t) return;
    const d = t.dataset;
    if (t.classList.contains('d-sheet-backdrop')) return closeSheet();
    if (d.act) { const [id, aid] = d.act.split(':'); const item = findAny(id); const action = currentAsk(s, id).actions.find(a => a.id === aid); closeSheet(); give(item, action, action.meaning === 'input' ? '1 张照片' : undefined); return; }
    if (d.ack) { closeSheet(); give(findAny(d.ack), { meaning: 'ack', label: '已阅', id: 'ack' }); return; }
    if (d.ackMany) { for (const id of d.ackMany.split(',')) local.set(versionKey(findAny(id)), { meaning: 'ack', label: '已阅', id: 'ack', at: s.cursor }); toast(`已阅 ${d.ackMany.split(',').length} 件 · 每件各记一条`); render(); return; }
    if (d.undo) { undo(findAny(d.undo)); return; }
    if (d.snooze) { snoozeSheet(findAny(d.snooze)); return; }
    if (d.snoozeAt) { const [id, at] = d.snoozeAt.split(':'); closeSheet(); flyToChip(id); give(findAny(id), { meaning: 'snooze', label: '稍后提醒', id: 'snooze', until: Number(at) }); if (s.selectedId === id) model.select(null); return; }
    if (d.openActions) { actionsSheet(findAny(d.openActions)); return; }
    if (d.open) { closeSheet(); if (s.selectedId) detailStack.push(s.selectedId); model.select(d.open); return; }
    if (d.surface) { surface = d.surface; render(); return; }
    if (d.labInspect) return; // handled by the lab shell
    switch (d.d) {
      case 'prev': model.goFrame(s.index - 1); return;
      case 'next': model.goFrame(s.index + 1); return;
      case 'surface': surface = surface === 'focus' ? 'inbox' : 'focus'; render(); toast(`切到「${surfaces.find(x => x.id === surface).label}」：${surface === 'inbox' ? '已阅即不再占位' : '已阅后仍按份额保留'}`); return;
      case 'stack': if (!event.target.closest('button')) { stackOpen = !stackOpen; render(); } return;
      case 'fold': foldSheet(); return;
      case 'back': model.select(detailStack.pop() || null); return;
      case 'reset': local.clear(); render(); toast('已清除本页反馈'); return;
      case 'snoozed': openSheet(`<h3>稍后提醒</h3><ul class="d-fold-list">${snoozedItems().map(({ item, f }) => `<li><small>${clock(f.until)} 再提醒 · 你 ${clock(f.at)} 设定</small><p>${esc(item.title)}</p><button class="d-link" data-undo="${esc(item.id)}">现在就看</button></li>`).join('')}</ul><p class="d-small">往后切换整理时刻，到点后它会回到原位，并注明期间是否有更新。</p>`); return;
    }
    if (t.classList.contains('d-card') || t.matches('.d-known-list li')) { detailStack.length = 0; model.select(t.dataset.id); }
  });
  host.addEventListener('submit', event => {
    const form = event.target.closest('[data-input]'); if (!form) return;
    event.preventDefault();
    const [id, aid] = form.dataset.input.split(':');
    const action = currentAsk(s, id).actions.find(a => a.id === aid);
    const raw = form.elements.v.value.trim(); if (!raw) { form.elements.v.focus(); return; }
    closeSheet(); give(findAny(id), action, action.input.type === 'money' ? `¥${Number(raw.replace(/[^\d.]/g, '')).toLocaleString('zh-CN')}` : raw);
  });
  host.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('.d-card')) { detailStack.length = 0; model.select(event.target.dataset.id); }
    if (event.key === 'Escape' && sheet) { event.stopPropagation(); closeSheet(); }
  }, true);
  // swipe the top of the stack to acknowledge it
  let drag = null;
  host.addEventListener('pointerdown', event => { const el = event.target.closest('[data-swipe]'); if (!el || event.target.closest('button')) return; drag = { el, x: event.clientX, id: el.dataset.swipe }; el.setPointerCapture(event.pointerId); });
  host.addEventListener('pointermove', event => { if (!drag) return; const dx = Math.min(0, event.clientX - drag.x); drag.dx = dx; drag.el.style.transform = `translateX(${dx}px)`; drag.el.style.opacity = String(1 + dx / 260); });
  host.addEventListener('pointerup', () => { if (!drag) return; const { el, dx = 0, id } = drag; drag = null; if (dx < -80) { give(findAny(id), { meaning: 'ack', label: '已阅', id: 'ack' }); } else { el.style.transform = ''; el.style.opacity = ''; if (Math.abs(dx) < 4) { stackOpen = true; render(); } } });
  $('.d-rail-range').addEventListener('input', event => model.goFrame(Number(event.target.value)));
  $('.d-base-select').addEventListener('change', event => model.setBase(Number(event.target.value)));
  $('.d-sheet-backdrop').addEventListener('click', closeSheet);

  function fit() {
    const device = $('.d-device');
    const wide = innerWidth > 760;
    const scale = wide ? Math.min(1, (innerHeight - 110) / 864) : 1;
    device.style.setProperty('--scale', scale.toFixed(3));
  }
  addEventListener('resize', fit); fit();
  const unsubscribe = model.subscribe((next, info) => {
    s = next;
    if (info.type === 'frame' && next.index !== lastIndex) { stackOpen = false; closeSheet(); if (next.selectedId && !getItem(next.state, next.selectedId)) model.select(null); }
    lastIndex = next.index;
    render();
  });
  return () => { disposed = true; unsubscribe(); removeEventListener('resize', fit); };
}
