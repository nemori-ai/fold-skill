// 12 智能眼镜（polish/glasses-concept.md）：Even G2 那样 576 × 288 的单色绿显示面，平时一个像素都不亮。
// 甲为底：要紧的问题里排第一的那一件（规则同腕上一瞥），只在它换了的那一轮经手机通知亮一次；乙是唯一的例外：你在和
// 等你的人通话（或她留言、未接）时，亮对方在等的那一件，别的要紧事按住，挂断后出一次。眼镜上不画 64 份。
// 显示面只由 Even Hub 的容器拼成（文本 ≤ 8、图片 ≤ 4、收手势的 1 个），按 1:1 像素画、量化到 16 级再着绿；亮度只用
// 四档：15 等你回应、11 你刚做的事、8 次要、5 环境。图片按真机的代价逐张送达（每张约 104 ms 加按面积分摊，整屏约 800 ms，
// 不并发），文本立刻换；不做真机做不到的补间。
// 操作：镜腿 / 戒指五个手势 = 轻点 Enter、双击 Backspace、上滑 ↑、下滑 ↓、长按 L；H 抬头 / 低头；[ / ] 上一个 / 下一个值得
// 看的时刻（推送、通话、挂断）；←/→ 换整理时刻；显示面上也能直接点、滑、长按。页底两周时间轴点一格跳到那一刻。
// 直接打开（顶层、不带 ?frame=、没有来源页）讲一遍约 10 秒，任意键或点按跳到终态；减弱动态时不讲。
// 作答只存在本页内存（respond.mjs）：先“已存”，下一轮整理后“已收到”，可撤回；不写回演示数据。
// ?at=<毫秒> 停在两轮之间的某一刻；?press=head,click,down 载入后依次按下（截静帧用）；?still=display|view 只出显示面或视野。
import { createResponseStore, responseStatus, normalizeAsk, setTimeZone } from '../respond.mjs';
import { familyPlace } from '../variants/shared.mjs?v=feedback-loop-1';
import { withDataset } from '../data/select.mjs';
import { shortAsk } from './watch.mjs';

export const W = 576, H = 288, LH = 27, PAD = 24;
export const GREEN = [60, 250, 68];              // #3CFA44, the G2 display green in Even's design guidelines
export const GREY = [0, 5, 8, 11, 15];            // textColor 0–4 → 16-level grey (an estimate; spec C.2)
export const LEVELS = new Set([0, 5, 8, 11, 15]);  // the only greys an image may use
export const LIMIT = { text: 8, image: 4 };
/** What one updateImageRawData costs on G2: ~104 ms fixed, plus its share of the ~800 ms a full screen (4 × 288 × 144) takes. */
export const imageMs = (w, h) => 104 + Math.round(96 * (w * h) / (288 * 144));
const HOUR = 3600000, DAY = 86400000, MIN = 60000;
const RANK = { critical: 0, high: 1, normal: 2, low: 3, trace: 4 };
const SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif';
const FONT = `24px ${SANS}`;
const row = k => 12 + LH * k;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const span = ms => { const a = Math.abs(ms); return a < HOUR ? `${Math.max(1, Math.round(a / MIN))} 分钟` : a < 2 * DAY ? `${Math.round(a / HOUR)} 小时` : `${Math.round(a / DAY)} 天`; };
const hm = ms => { const m = Math.max(0, Math.round(ms / MIN)), h = Math.floor(m / 60); return h ? `${h} 小时 ${m % 60} 分` : `${m} 分钟`; };
const byKey = (a, b) => { for (let i = 0; i < a.key.length; i += 1) if (a.key[i] !== b.key[i]) return a.key[i] < b.key[i] ? -1 : 1; return 0; };
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function formatter(zone) {
  const hmF = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const mdF = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, month: 'numeric', day: 'numeric' });
  const hourF = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' });
  const clock = t => hmF.format(new Date(t));
  const day = t => mdF.format(new Date(t)).replace('月', '/').replace('日', '');
  const dueText = (due, now) => { const d = day(due); return `${d === day(now) ? '今天' : d === day(now + DAY) ? '明天' : d} ${clock(due)} 前`; };
  return { clock, day, dueText, hour: t => Number(hourF.format(new Date(t))) };
}

// ---------- what the glasses may show: derived read-only from the replay (spec §B, §C.1) ----------
export function derive(kit) {
  const { scenario, records, currentAsk, findEvent } = kit;
  const frames = scenario.frames, stamps = frames.map(f => Date.parse(f.at));
  const frameAt = t => { let k = 0; stamps.forEach((s, j) => { if (s <= t) k = j; }); return k; };
  // Who is waiting: the rule of 等待链 (chain.mjs) — authors of this version's cited inputs, less you, machines,
  // public documents and strangers; each timed from their earliest cited input.
  const persona = scenario.persona?.name;
  const isSelf = e => Boolean(e?.self) || (Boolean(persona) && e?.from === persona);
  const MACHINE = new Set(['bot', 'automation']), STRANGERS = new Set(['life', 'community', 'subscription']);
  const counts = e => Boolean(e) && !isSelf(e) && !MACHINE.has(e.author_kind) && !e.publicSourceId && !String(e.from || '').startsWith('~') && !STRANGERS.has(e.stream);
  const nameOf = e => String(familyPlace(e)?.who || e.from || '').split(/ · |, /)[0].trim();
  function waitersOf(item, t) {
    const by = new Map();
    for (const src of item.sources || []) {
      const ref = String(src.ref || '');
      if (!ref.startsWith('event:')) continue;
      const e = findEvent(ref.slice(6));
      if (!counts(e) || Date.parse(e.at) > t) continue;
      const who = nameOf(e), at = Date.parse(e.at), w = by.get(who);
      if (!w) by.set(who, { who, since: at, n: 1 }); else { w.n += 1; w.since = Math.min(w.since, at); }
    }
    return [...by.values()].sort((a, b) => a.since - b.since || (a.who < b.who ? -1 : 1));
  }
  const dueOf = (item, ask) => { const v = ask?.due_at || (item.kind !== 'done' ? item.due_at : null); const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
  const walk = (layer, out = []) => { for (const it of layer?.items || []) { out.push(it); walk(it.children, out); } return out; };
  // Open asks at time t on the state of batch k; urgent and order as 腕上一瞥 (watch.mjs): due within 24 h (incl. overdue)
  // or weight critical / high; [weight, ≤ 24 h first, due, −share]. Share only breaks ties and never reaches the screen.
  function openAt(k, t, state = records[k].state) {
    const s = { index: k, state };
    return walk(state.root).map(item => ({ item, raw: currentAsk(s, item.id) })).filter(x => x.raw).map(({ item, raw }) => {
      const due = dueOf(item, raw);
      return { id: raw.id, item, raw, ask: normalizeAsk(raw), short: shortAsk(raw, item), due, waiters: waitersOf(item, t),
        urgent: (due != null && due - t < DAY) || (RANK[item.weight] ?? 2) <= 1,
        key: [RANK[item.weight] ?? 2, due != null && due - t < DAY ? 0 : 1, due ?? Infinity, -(item.share || 0)] };
    }).sort(byKey);
  }
  // 甲: the top urgent ask at each batch; a push is a batch where it changes to another ask (spec §B: composite 4 in 28).
  const registered = new Map();
  const tops = frames.map((f, k) => {
    const open = openAt(k, stamps[k]);
    for (const a of open) if (!registered.has(a.id)) registered.set(a.id, stamps[k]);
    return open.find(a => a.urgent) || null;
  });
  const pushes = [];
  tops.forEach((a, k) => { if (a && a.id !== tops[k - 1]?.id) pushes.push({ k, t: stamps[k], id: a.id, short: a.short }); });
  // 乙: calls, missed calls and voicemails in the family stream; lit when the other side is among an open ask's waiters.
  const calls = [];
  for (const f of frames) for (const e of f.events || []) {
    if (!['call_log', 'missed_call', 'voicemail'].includes(e.kind)) continue;
    const text = String(e.text || '');
    const raw = e.kind === 'call_log' ? text.match(/till (.+?) ·/)?.[1] : text.match(/från (.+?)(?: \(|\n|$)/)?.[1];
    if (!raw) continue;
    const who = familyPlace({ stream: 'family', from: raw, channel: '' })?.who || raw;
    const t = Date.parse(e.at), k = frameAt(t), open = openAt(k, t);
    const minutes = Number(text.match(/· (\d+) min/)?.[1] || 0), seconds = Number(text.match(/\((\d+) s\)/)?.[1] || 0);
    const matched = open.filter(a => a.waiters.some(w => w.who === who));
    const held = open.filter(a => a.urgent && !matched.includes(a));
    calls.push({ id: e.id, kind: e.kind, t, end: t + (e.kind === 'call_log' ? Math.max(1, minutes) : 1) * MIN, who, minutes, seconds, k,
      matched: matched.map(a => a.id), held: held.map(a => a.id), lit: matched.length > 0, open: open.length });
  }
  calls.sort((a, b) => a.t - b.t);
  const moments = [
    ...pushes.map(p => ({ t: p.t, kind: 'push', id: p.id })),
    ...calls.filter(c => c.lit).flatMap(c => [{ t: c.t, kind: 'call', call: c.id },
      ...(c.kind === 'call_log' && c.held.length ? [{ t: c.end, kind: 'hangup', call: c.id }] : [])]),
  ].sort((a, b) => a.t - b.t);
  return { frames, stamps, frameAt, openAt, registered, tops, pushes, calls, moments, start: stamps[0], end: Date.parse(scenario.endAt) };
}

// ---------- images: 4-bit pixels, only the four greys ----------
const bits = (w, h) => {
  const px = new Uint8Array(w * h);
  return { w, h, px, fill(x, y, rw, rh, v) {
    for (let j = Math.max(0, y); j < Math.min(h, y + rh); j += 1) for (let i = Math.max(0, x); i < Math.min(w, x + rw); i += 1) px[j * w + i] = Math.max(px[j * w + i], v);
  } };
};
const UNITS = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];
/** Time ruler: one cell a unit from `from` to the deadline; elapsed 8, still left a 5 stub, the last cell before the
 *  deadline 15 at full height, hours past it 15. No deadline: elapsed cells only. */
export function ruler({ from, now, due, w = 288, h = 24, max = 36 }) {
  const start = Math.min(from, now);
  const b = bits(w, h), n = { past: 0, left: 0, over: 0, due: 0 };
  let unit, cells;
  if (due == null) {
    unit = UNITS.find(u => Math.ceil((now - start) / u) <= max) || UNITS.at(-1);
    cells = Array.from({ length: Math.max(1, Math.ceil((now - start) / unit)) }, () => 'past');
  } else {
    const before = Math.max(1, due - start), after = Math.max(0, now - due);
    unit = UNITS.find(u => Math.ceil(before / u) + Math.ceil(after / u) <= max) || UNITS.at(-1);
    const m = Math.ceil(before / unit), o = Math.ceil(after / unit);
    cells = [];
    for (let j = -m; j < o; j += 1) cells.push(j === -1 ? 'due' : j >= 0 ? 'over' : due + j * unit < now ? 'past' : 'left');
  }
  const pitch = Math.min(14, Math.floor((w + 2) / cells.length)), gap = pitch >= 6 ? 2 : 1, cw = pitch - gap;
  const LOOK = { past: [8, Math.max(8, h - 8)], left: [5, 4], due: [15, h], over: [15, h - 4] };
  cells.forEach((kind, i) => { const [v, ch] = LOOK[kind]; n[kind] += 1; b.fill(i * pitch, h - ch, cw, ch, v); });
  return { ...b, unit, cells: cells.length, n };
}
const SHORT_UNITS = [10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR];
/** Saved → the next 整理: elapsed 11 (what you just did), left a 5 stub, the landing cell 11 at full height. */
export function landing({ from, now, to, w = 288, h = 20 }) {
  const unit = SHORT_UNITS.find(u => Math.ceil((to - from) / u) <= 24) || SHORT_UNITS.at(-1);
  const n = Math.max(1, Math.ceil((to - from) / unit)), pitch = Math.min(14, Math.floor((w + 2) / n)), cw = pitch - 2, b = bits(w, h);
  for (let i = 0; i < n; i += 1) {
    const last = i === n - 1, a = from + i * unit;
    if (last) b.fill(i * pitch, 0, cw, h, 11); else if (a < now) b.fill(i * pitch, 8, cw, h - 8, 11); else b.fill(i * pitch, h - 4, cw, 4, 5);
  }
  return { ...b, unit, cells: n };
}
/** Call minutes from the call log: elapsed 8, still to come 5 (a stub); one cell a minute (two past 28 minutes). */
export function minutes({ total, elapsed, h = 20 }) {
  const per = total > 28 ? 2 : 1, n = Math.max(1, Math.ceil(total / per)), pitch = 10, b = bits(Math.max(20, n * pitch - 2), h);
  for (let i = 0; i < n; i += 1) { if (i * per < elapsed) b.fill(i * pitch, h - 14, 8, 14, 8); else b.fill(i * pitch, h - 4, 8, 4, 5); }
  return { ...b, per, cells: n };
}
/** The number after each option label in the prompt — 整根挖开换（约 6.8 万克朗） — when every option has one in one unit. */
export function amounts(raw, actions) {
  const prompt = String(raw?.prompt || '');
  const out = actions.map(a => {
    const m = prompt.match(new RegExp(`${escapeRe(a.label)}[（(]([^）)]*?([\\d.]+)\\s*(万|千|百)?[^）)]*)[）)]`));
    return m ? { label: a.label, note: m[1].trim(), v: Number(m[2]), unit: m[3] || '' } : null;
  });
  return out.length >= 2 && out.every(Boolean) && new Set(out.map(o => o.unit)).size === 1 ? out : null;
}
/** An option's amount as cells of one unit (1 万 per cell while the largest fits in 7 cells). */
export function bars({ v, max, on, w = 226, h = 20 }) {
  const per = Math.max(1, Math.ceil(max / 7)), cells = v / per, pitch = 32, b = bits(w, h), level = on ? 15 : 5;
  for (let i = 0; i < Math.ceil(cells); i += 1) b.fill(i * pitch, 3, Math.round(Math.min(1, cells - i) * (pitch - 4)), h - 6, level);
  return { ...b, per };
}
export const initialOf = name => { const parts = String(name || '?').trim().split(/\s+/); const latin = parts.find(p => /^[A-Za-zÀ-ž]/.test(p)); return [...(latin || parts[0] || '?')][0].toUpperCase(); };
let glyphCtx = null;
/** Who is waiting: one 32 × 32 block a person, the first letter as a 16 × 16 glyph drawn in 2 × 2 blocks (one grey). */
export function initials(people, levelOf = () => 8) {
  const list = people.slice(0, 6), cell = 32, gap = 8, b = bits(Math.max(20, list.length * (cell + gap) - gap), cell);
  glyphCtx ||= Object.assign(document.createElement('canvas'), { width: 16, height: 16 }).getContext('2d', { willReadFrequently: true });
  const g = glyphCtx;
  list.forEach((p, i) => {
    g.clearRect(0, 0, 16, 16); g.fillStyle = '#fff'; g.font = `600 15px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(initialOf(p.who), 8, 9);
    const d = g.getImageData(0, 0, 16, 16).data, v = levelOf(p);
    for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) if (d[(y * 16 + x) * 4 + 3] > 110) b.fill(i * (cell + gap) + x * 2, y * 2, 2, 2, v);
  });
  return b;
}
const CHECK = ['............', '............', '..........##', '.........##.', '........##..', '##.....##...', '.##...##....', '..##.##.....', '...###......', '....#.......', '............', '............'];
/** A 24 × 24, 1-bit check drawn in 2 × 2 blocks (the icon rules: strokes at least 2 px). */
export function check(v) { const b = bits(24, 24); CHECK.forEach((r, j) => [...r].forEach((c, i) => { if (c === '#') b.fill(i * 2, j * 2, 2, 2, v); })); return b; }

// ---------- containers and the painter ----------
let measureCtx = null;
export const textWidth = s => { measureCtx ||= document.createElement('canvas').getContext('2d'); measureCtx.font = FONT; return Math.ceil(measureCtx.measureText(String(s)).width); };
const T = (name, x, y, w, h, text, c, more = {}) => ({ type: 'text', name, x, y, w, h, text: String(text ?? ''), c, ...more });
const I = (name, x, y, img, src) => ({ type: 'image', name, x, y, w: img.w, h: img.h, px: img.px, src });
const right = (name, text, y, c, edge = PAD) => T(name, W - edge - textWidth(text) - 2, y, textWidth(text) + 4, LH, text, c);
const hash = px => { let h = 2166136261; for (let i = 0; i < px.length; i += 1) h = Math.imul(h ^ px[i], 16777619); return (h >>> 0).toString(36); };
export const imageKey = c => `${c.name}|${c.x},${c.y},${c.w}x${c.h}|${hash(c.px)}`;
function wrap(ctx, text, width) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of para) { if (line && ctx.measureText(line + ch).width > width) { out.push(line); line = ch; } else line += ch; }
    out.push(line);
  }
  return out;
}
/** Paint containers onto a 576 × 288 canvas: white at grey/15 on black, then every pixel to 16 levels, tinted green. */
export function paint(canvas, page, delivered = c => c) {
  const x = canvas.getContext('2d', { willReadFrequently: true });
  x.save(); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  x.textBaseline = 'top'; x.font = FONT;
  for (const k of page) {
    if (k.type === 'image') {
      const img = delivered(k);
      if (!img) continue;
      const data = x.createImageData(img.w, img.h);
      for (let i = 0; i < img.px.length; i += 1) { const v = Math.round(img.px[i] * 17); data.data.set([v, v, v, 255], i * 4); }
      x.putImageData(data, k.x, k.y);
      continue;
    }
    const bw = k.bw || 0, p = k.p || 0;
    if (bw) {
      x.globalAlpha = (k.bc ?? GREY[k.c ?? 4]) / 15; x.strokeStyle = '#fff'; x.lineWidth = bw;
      x.beginPath(); x.roundRect(k.x + bw / 2, k.y + bw / 2, k.w - bw, k.h - bw, k.r || 0); x.stroke();
    }
    if (!k.text.trim()) continue;
    x.save(); x.beginPath(); x.rect(k.x, k.y, k.w, k.h); x.clip();
    x.globalAlpha = GREY[k.c ?? 4] / 15; x.fillStyle = '#fff';
    wrap(x, k.text, k.w - 2 * (bw + p)).forEach((line, i) => x.fillText(line, k.x + bw + p, k.y + bw + p + i * LH + 1));
    x.restore();
  }
  x.restore();
  const d = x.getImageData(0, 0, W, H), a = d.data;
  for (let i = 0; i < a.length; i += 4) { const q = Math.round((a[i] / 255) * 15) / 15; a[i] = GREEN[0] * q; a[i + 1] = GREEN[1] * q; a[i + 2] = GREEN[2] * q; a[i + 3] = 255; }
  x.putImageData(d, 0, 0);
}

// ---------- the first-person view: a 60° lens, 20 px a degree, flat planes; the display adds green light ----------
const VW = 1200, VH = 720, PPD = 20;
const G2 = { cx: 0, cy: 4, w: 24.6, h: 12.3 };
export const displayRect = { x: VW / 2 + (G2.cx - G2.w / 2) * PPD, y: VH / 2 - (G2.cy + G2.h / 2) * PPD, w: G2.w * PPD, h: G2.h * PPD };
const SCENES = {
  kitchen(x) {
    const r = (c, a, b, w, h) => { x.fillStyle = c; x.fillRect(a, b, w, h); };
    r('#4d4a46', 0, 0, VW, VH); r('#6c7a86', 110, 90, 300, 250); r('#4d4a46', 256, 90, 8, 250);
    r('#3c3935', 0, 450, VW, 270); r('#2f2c29', 0, 450, VW, 6); r('#6d6862', 640, 372, 70, 84); r('#5b5650', 840, 418, 220, 34); r('#433f3b', 800, 130, 220, 140);
  },
  street(x) {
    const r = (c, a, b, w, h) => { x.fillStyle = c; x.fillRect(a, b, w, h); };
    r('#5f6f7c', 0, 0, VW, 360); r('#4f524d', 0, 280, 360, 110); r('#4a4c48', 820, 250, 380, 140); r('#3e4236', 0, 360, VW, 360);
    x.fillStyle = '#58544b'; x.beginPath(); x.moveTo(560, 360); x.lineTo(640, 360); x.lineTo(930, VH); x.lineTo(270, VH); x.closePath(); x.fill();
    x.fillStyle = '#33392e'; [[170, 320, 70], [1010, 310, 80], [1130, 335, 55]].forEach(([a, b, rr]) => { x.beginPath(); x.arc(a, b, rr, 0, 7); x.fill(); });
  },
  desk(x) {
    const r = (c, a, b, w, h) => { x.fillStyle = c; x.fillRect(a, b, w, h); };
    r('#1f2124', 0, 0, VW, VH); r('#2c3036', 280, 300, 640, 330); r('#3c4552', 296, 316, 608, 298); r('#2e2a25', 0, 600, VW, 120); r('#24211d', 560, 616, 80, 30);
  },
};
export const SCENE_WORDS = { kitchen: '清晨厨房', street: '通话时走在路上', desk: '桌前' };
export function paintView(canvas, display, scene) {
  const x = canvas.getContext('2d'), k = canvas.width / VW;
  x.save(); x.setTransform(k, 0, 0, k, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none';
  SCENES[scene](x);
  x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(0, 0, VW, VH);   // indoor / dusk exposure: the light in this picture is the display
  const R = displayRect;
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.globalCompositeOperation = 'lighter';
  x.filter = 'blur(3px)'; x.globalAlpha = 0.55; x.drawImage(display, R.x, R.y, R.w, R.h);
  x.filter = 'none'; x.globalAlpha = 1; x.drawImage(display, R.x, R.y, R.w, R.h);
  x.globalCompositeOperation = 'source-over';
  x.setLineDash([3, 5]); x.strokeStyle = 'rgba(255,255,255,.2)'; x.lineWidth = 1; x.strokeRect(Math.round(R.x) + 0.5, Math.round(R.y) + 0.5, Math.round(R.w), Math.round(R.h));
  x.restore();
}

// ---------- the page ----------
export function mount(stage, model, kit) {
  const zone = kit.scenario.timeZone || 'Asia/Shanghai';
  setTimeZone(zone);
  const F = formatter(zone), D = derive(kit), store = createResponseStore();
  const params = new URLSearchParams(location.search), still = params.get('still');
  const formFrame = Number(params.get('frame')) || 26;
  document.body.classList.add('gl-page');
  if (still) document.body.classList.add('gl-still', `gl-still-${still}`);
  const lit = D.calls.filter(c => c.lit);
  stage.innerHTML = `<div class="gl-wrap">
    <p class="gl-lede" aria-live="polite"><b class="gl-when"></b><span class="gl-what"></span></p>
    <div class="gl-main">
      <figure class="gl-fig gl-fig-display">
        <div class="gl-screen" role="img" aria-label="眼镜显示面 576 × 288"><canvas class="gl-px" width="${W}" height="${H}"></canvas></div>
        <figcaption><b>显示面</b><span class="gl-count"></span><span class="gl-scale"></span></figcaption>
      </figure>
      <figure class="gl-fig gl-fig-view">
        <canvas class="gl-view" width="${VW}" height="${VH}" role="img" aria-label="第一人称视野"></canvas>
        <figcaption><b>视野</b><span class="gl-scene"></span></figcaption>
      </figure>
    </div>
    <div class="gl-pad" role="group" aria-label="镜腿与戒指">
      <span class="gl-pad-name">镜腿 / R1 戒指</span>
      <button type="button" data-g="click">轻点<kbd>Enter</kbd></button>
      <button type="button" data-g="double">双击<kbd>⌫</kbd></button>
      <button type="button" data-g="up">上滑<kbd>↑</kbd></button>
      <button type="button" data-g="down">下滑<kbd>↓</kbd></button>
      <button type="button" data-g="long">长按<kbd>L</kbd></button>
      <span class="gl-pad-gap"></span>
      <button type="button" data-g="head" aria-pressed="false">抬头<kbd>H</kbd></button>
      <button type="button" data-m="-1" aria-label="上一个时刻">‹ 时刻<kbd>[</kbd></button>
      <button type="button" data-m="1" aria-label="下一个时刻">时刻 ›<kbd>]</kbd></button>
    </div>
    <section class="gl-weeks" aria-label="两周里眼镜亮过哪几次">
      <p class="gl-weeks-h"><b>两周 ${D.frames.length - 1} 轮</b><span><i class="gl-k-push"></i>甲 亮 ${D.pushes.length} 次（最前那件换了）</span>
        <span><i class="gl-k-call"></i>乙 对上 ${lit.length} 次${D.calls.length ? `（通话、未接与留言共 ${D.calls.length} 次）` : '（这份数据没有通话记录）'}</span><span><i class="gl-k-miss"></i>对不上的通话</span></p>
      <div class="gl-axis"></div>
    </section>
    <p class="gl-keys"><span class="gl-keys-t"></span><button type="button" class="gl-replay" data-x="replay" hidden>↺ 重演</button></p>
  </div>`;
  const $ = sel => stage.querySelector(sel);
  const px = $('.gl-px'), screenEl = $('.gl-screen'), view = $('.gl-view'), axis = $('.gl-axis'), wrapEl = $('.gl-wrap');
  const pct = t => `${(((t - D.start) / (D.end - D.start)) * 100).toFixed(3)}%`;
  // The two weeks: a tick a round (bright where 甲 pushed), a dot a call (bright where 乙 matched), the cursor.
  axis.innerHTML = `${D.frames.map((f, k) => (k ? `<button type="button" class="gl-round${D.pushes.some(p => p.k === k) ? ' is-push' : ''}" data-k="${k}" style="left:${pct(D.stamps[k])}" title="${kit.esc(`${F.day(D.stamps[k])} ${F.clock(D.stamps[k])} · ${f.id}${D.pushes.find(p => p.k === k) ? ` · 亮：${D.pushes.find(p => p.k === k).short}` : ''}`)}"></button>` : '')).join('')}
    ${D.calls.map(c => `<button type="button" class="gl-call${c.lit ? ' is-lit' : ''}" data-t="${c.t}" style="left:${pct(c.t)}" title="${kit.esc(`${F.day(c.t)} ${F.clock(c.t)} · ${c.who} · ${{ call_log: `通话 ${c.minutes} 分钟`, missed_call: '未接来电', voicemail: `留言 ${c.seconds} 秒` }[c.kind]}${c.lit ? '' : ' · 对不上'}`)}"></button>`).join('')}
    ${Array.from({ length: Math.round((D.end - D.start) / DAY) + 1 }, (_, i) => D.start + i * DAY).filter((t, i, all) => i % 2 === 0 && i < all.length - 1).map(t => `<span class="gl-day" style="left:${pct(t)}">${F.day(t)}</span>`).join('')}
    <span class="gl-now"></span>`;

  let s = model.snapshot();
  const ui = { screen: 'off', sel: 0, subject: null, ctx: null, from: 'off', head: false };
  let tour = null;
  const keys = $('.gl-keys-t');

  // ---------- facts at the cursor ----------
  // Answered: a record for this item version, or for an earlier version of the same ask (a rewrite re-registers it; as 回应托盘).
  const statusOf = a => { const r = a && (store.forItem(a.item, s.cursor) || store.list(s.cursor).filter(x => x.ask === a.id).at(-1)); return r ? { r, st: responseStatus(r, D.frames, s.cursor).status } : null; };
  function facts() {
    const t = s.cursor, k = s.index, open = D.openAt(k, t, s.state);
    const urgent = open.filter(a => a.urgent);
    return { t, k, open, urgent, top: urgent.find(a => !statusOf(a)) || null, done: urgent.find(a => statusOf(a)) || null,
      push: D.pushes.find(p => p.k === k), byId: id => open.find(a => a.id === id) || null };
  }
  const choicesOf = a => {
    if (!a || ['reply', 'schedule', 'defer'].includes(a.ask.expects)) return null;
    const c = a.ask.actions.filter(x => x.meaning === 'decide' || x.meaning === 'act');
    return c.length >= 1 && c.length <= 4 ? c : null;
  };
  const phoneWhy = a => ({ reply: '要写一句', schedule: '要挑时间', defer: '要挑推到哪天' })[a.ask.expects] || '选项太多';
  const callOf = id => D.calls.find(c => c.id === id);
  const header = (left, c = 1) => (left ? [T('head', PAD, row(0), 360, LH, left, c)] : []);
  const clockBox = () => right('clock', F.clock(s.cursor), row(0), 1);
  const ev = T('ev', 0, 0, W, H, ' ', 1, { ev: true });
  const dueLines = (a, x, y) => {
    const out = [];
    if (a.due != null) { out.push(T('left', x, y, W - PAD - x, LH, `${a.due >= s.cursor ? '还有' : '已过'} ${span(a.due - s.cursor)}`, 2)); out.push(T('due', x, y + LH, W - PAD - x, LH, F.dueText(a.due, s.cursor), 1)); }
    else out.push(T('left', x, y, W - PAD - x, LH, `开了 ${span(s.cursor - (D.registered.get(a.id) ?? s.cursor))}`, 2));
    return out;
  };
  const rulerOf = (a, from, y, h = 24) => I('ruler', PAD, y, ruler({ from, now: s.cursor, due: a.due, h }),
    `${a.due != null ? 'ask.due_at（没有就用 item.due_at）' : '不设期限'}；起点：${from === D.registered.get(a.id) ? '问题第一次登记的那一轮' : '等你的人在依据里最早那条输入'}；此刻`);
  const waitersImg = (a, y, onLine = null) => (a.waiters.length ? [
    I('who', PAD, y, initials(a.waiters, p => (p.who === onLine ? 11 : 8)), '谁在等：这一版依据的作者（等待链的规则），一人一块，首字母或首字'),
    T('whoLabel', PAD + Math.min(6, a.waiters.length) * 40 + 4, y + 2, 240, LH, `${a.waiters.length > 6 ? `等 ${a.waiters.length} 人` : '在等你'}`, 1)] : []);
  const receiptRows = (a, y) => {
    const { r, st } = statusOf(a), out = [];
    if (st === 'saved') {
      const next = D.frames.find(f => Date.parse(f.at) > r.at), to = next ? Date.parse(next.at) : D.end;
      out.push(I('check', PAD, y + 2, check(11), '回应记录（respond.mjs，只在本页内存）'));
      out.push(T('saved', PAD + 36, y, 492, LH, `已存 · ${r.label}`, 3));
      out.push(I('landing', PAD + 36, y + 40, landing({ from: r.at, now: s.cursor, to }), '从作答到下一轮整理：frames 里下一轮的时间'));
      out.push(T('next', PAD + 36 + 300, y + 34, 200, LH, `${F.clock(to)} 整理`, 1));
      out.push(T('wait', PAD + 36 + 300, y + 34 + LH, 200, LH, `还要 ${hm(to - s.cursor)}`, 1));
    } else {
      const next = D.frames.find(f => Date.parse(f.at) > r.at);
      out.push(I('check', PAD, y + 2, check(5), '回应记录（respond.mjs，只在本页内存）'));
      out.push(T('saved', PAD + 36, y, 492, LH, `已收到 · ${r.label}`, 1));
      out.push(T('next', PAD + 36, y + LH, 492, LH, `${next ? F.clock(next.at) : ''} 整理读到了`, 1));
    }
    return out;
  };

  // ---------- the pages, one per screen ----------
  const PAGES = {
    off: () => [ev],
    // A neutral phone notification: plugins cannot push (Even Hub FAQ); the Even app mirrors it, the style is the system's.
    notice(f) {
      const a = f.byId(f.push?.id) || f.top;
      if (!a) return [ev];
      const who = a.waiters.map(w => w.who).slice(0, 2).join('、');
      return [ev,
        T('card', 48, 34, 480, 170, '', 2, { bw: 1, bc: 8, r: 6, sys: true }),
        T('src', 68, 46, 300, LH, '手机通知 · Fold', 2, { sys: true }), T('now', 444, 46, 70, LH, '现在', 1, { sys: true }),
        T('title', 68, 84, 440, LH, a.short, 4, { sys: true }),
        T('body', 68, 84 + LH, 440, LH * 2, [a.due != null ? F.dueText(a.due, s.cursor) : '', who ? `${who} 在等` : ''].filter(Boolean).join(' · '), 2, { sys: true }),
        T('hint', 68, 166, 440, LH, '轻点打开 · 双击收起', 1, { sys: true })];
    },
    // 甲: the one line, its time ruler and who is waiting; “另 N 件不用现在” only says nothing was dropped.
    item(f) {
      const a = f.top, out = [ev, clockBox()], rest = f.open.length - (a || f.done ? 1 : 0);
      if (f.push && a && f.push.id === a.id && s.cursor - f.push.t < 12 * HOUR) out.push(...header(`${F.clock(f.push.t)} 整理 · 最前换成这一件`));
      if (a) {
        out.push(T('title', PAD, row(1) + 5, W - 2 * PAD, LH, a.short, 4));
        out.push(rulerOf(a, D.registered.get(a.id) ?? s.cursor, 86), ...dueLines(a, 330, 80));
        out.push(...waitersImg(a, 148));
      } else if (f.done) out.push(...receiptRows(f.done, row(2)));
      else out.push(T('none', PAD, row(2), W - 2 * PAD, LH, '没有要你开口的事', 1));
      out.push(T('rest', PAD, row(9), W - 2 * PAD, LH, `另 ${rest} 件不用现在`, 1));
      return out;
    },
    // 乙: whom you are talking to, the ask she is waiting on, how long she has waited, and the minutes of the call.
    call(f) {
      const c = ui.ctx, a = f.byId(c.matched[0]), out = [ev];
      const what = { call_log: '通话中', missed_call: '未接来电', voicemail: `留言 ${c.seconds} 秒` }[c.kind];
      // A call shows its minutes top right; a voicemail or a missed call has no minutes, so its time joins the head line
      // (a separate clock would be the ninth text container on this page).
      if (c.kind === 'call_log') {
        out.push(T('head', PAD, row(0), 300, LH, `${c.who} · ${what}`, 2));
        const m = minutes({ total: c.minutes, elapsed: Math.floor((s.cursor - c.t) / MIN) });
        out.push(I('minutes', W - PAD - m.w, 14, m, '通话记录：时长（Utgående samtal … · N min），亮格是已通话的分钟'));
      } else out.push(T('head', PAD, row(0), W - 2 * PAD, LH, `${c.who} · ${what} · ${F.clock(s.cursor)}`, 2));
      if (!a) return out;
      if (statusOf(a)) out.push(T('title', PAD, row(1) + 5, W - 2 * PAD, LH, a.short, 2), ...receiptRows(a, 92));
      else {
        const w = a.waiters.find(x => x.who === c.who);
        out.push(T('title', PAD, row(1) + 5, W - 2 * PAD, LH, a.short, 4));
        out.push(rulerOf(a, w?.since ?? s.cursor, 86));
        out.push(T('waited', 330, 80, W - PAD - 330, LH, `${c.who}等了 ${span(s.cursor - (w?.since ?? s.cursor))}`, 2));
        if (a.due != null) out.push(T('left', 330, 80 + LH, W - PAD - 330, LH, `${a.due >= s.cursor ? '还有' : '已过'} ${span(a.due - s.cursor)}`, 1));
        const ch = choicesOf(a);
        out.push(T('opts', PAD, 140, W - 2 * PAD, LH, ch ? ch.map(x => x.label).join(' · ') : `到手机上答：${phoneWhy(a)}`, 2));
        out.push(...waitersImg(a, 178, c.who));
      }
      if (c.held.length) out.push(T('rest', PAD, row(9), W - 2 * PAD, LH, `另 ${c.held.length} 件要紧${c.kind === 'call_log' ? ' · 挂断后再说' : ''}`, 1));
      return out;
    },
    // 乙, after the call: what was held, once, each with its own ruler (overdue hours at 15).
    hangup(f) {
      const c = ui.ctx, held = c.held.map(id => f.byId(id)).filter(Boolean), out = [ev, T('head', PAD, row(0), 360, LH, `挂断了 · 刚才按住 ${held.length} 件`, 1), clockBox()];
      held.slice(0, 2).forEach((a, i) => {
        const y = 48 + i * 84, on = i === ui.sel;
        out.push(T(`t${i}`, PAD - 8, y - 4, W - 2 * PAD + 16, 40, `${on ? '>' : ' '} ${a.short}`, statusOf(a) ? 1 : 4, { bw: on ? 2 : 0, bc: 15, r: 6, p: 4 }));
        if (!statusOf(a)) out.push(I(`r${i}`, PAD, y + 42, ruler({ from: D.registered.get(a.id) ?? s.cursor, now: s.cursor, due: a.due, h: 20 }), 'ask.due_at；起点：问题第一次登记的那一轮'),
          T(`l${i}`, 330, y + 36, W - PAD - 330, LH, a.due != null ? `${a.due >= s.cursor ? '还有' : '已过'} ${span(a.due - s.cursor)}` : '没有期限', 2));
      });
      if (held.length > 2) out.push(T('rest', PAD, row(9), W - 2 * PAD, LH, `另 ${held.length - 2} 件`, 1));
      return out;
    },
    answer(f) {
      const a = f.byId(ui.subject), out = [ev];
      if (!a) return out;
      const top = ui.ctx && ui.from !== 'hangup' ? row(1) + 5 : row(0);
      if (ui.ctx && ui.from !== 'hangup') out.push(T('head', PAD, row(0), 300, LH, `${ui.ctx.who} · 通话中`, 2));
      out.push(T('title', PAD, top, W - 2 * PAD, LH, a.short, 4));
      const ch = choicesOf(a);
      if (!ch) {
        out.push(T('phone', PAD, top + 48, W - 2 * PAD, LH, `到手机上答：${phoneWhy(a)}`, 2));
        out.push(T('hint', PAD, row(9), W - 2 * PAD, LH, '长按交给手机 · 双击收起', 1));
        return out;
      }
      const money = ch.length === 2 && amounts(a.raw, ch);
      if (money) {
        const max = Math.max(...money.map(m => m.v));
        money.forEach((m, i) => {
          const on = i === ui.sel, x = PAD + i * 270, y = top + 44;
          out.push(T(`o${i}`, x, y, 258, 112, `${m.label}\n${m.note}`, on ? 4 : 2, { bw: on ? 3 : 1, bc: on ? 15 : 5, r: 8, p: 12 }));
          out.push(I(`b${i}`, x + 16, y + 112 - 34, bars({ v: m.v, max, on }), `选项金额：问题原文里选项后的括号（${m.note}），一格 1 ${m.unit}`));
        });
      } else ch.forEach((o, i) => {
        const on = i === ui.sel;
        out.push(T(`o${i}`, PAD - 8, top + 40 + i * 44, 320, 40, `${on ? '>' : ' '} ${o.label}`, on ? 4 : 2, { bw: on ? 2 : 0, bc: 15, r: 6, p: 4 }));
      });
      out.push(T('hint', PAD, row(9), W - 2 * PAD, LH, '滑动换选 · 轻点确定 · 双击收起', 1));
      return out;
    },
    receipt(f) {
      const a = f.byId(ui.subject), out = [ev];
      if (!a || !statusOf(a)) return out;
      if (ui.ctx && ui.from !== 'hangup') out.push(T('head', PAD, row(0), 300, LH, `${ui.ctx.who} · 通话中`, 2));
      out.push(T('title', PAD, row(1) + 5, W - 2 * PAD, LH, a.short, 2), ...receiptRows(a, 92));
      out.push(T('hint', PAD, row(9), W - 2 * PAD, LH, '双击撤回 · 轻点收起', 1));
      return out;
    },
  };

  // ---------- where the cursor lands, and the gestures ----------
  function landOn() {
    const t = s.cursor;
    const c = lit.find(x => x.t <= t && t < x.end);
    const h = lit.find(x => x.kind === 'call_log' && x.held.length && x.end <= t && t < x.end + MIN);
    Object.assign(ui, { sel: 0, subject: null, ctx: c || h || null, from: 'off', head: false });
    ui.screen = c ? 'call' : h ? 'hangup' : D.pushes.some(p => p.t === t) ? 'notice' : 'off';
  }
  const toast = text => kit.toast(text);
  function open(a, from) {
    if (!a) return;
    if (!choicesOf(a)) { toast(`这一件${phoneWhy(a)}，眼镜上不答：长按交给手机`); }
    Object.assign(ui, { screen: 'answer', subject: a.id, from, sel: 0 });
  }
  function press(g) {
    const f = facts(), sc = ui.screen;
    if (g === 'head') { if (sc === 'off' || sc === 'notice') Object.assign(ui, { screen: 'item', head: true }); else Object.assign(ui, { screen: 'off', head: false, ctx: null }); return render(); }
    if (g === 'long') { toast('本页演示：手机上会打开 D 的这一件'); return; }
    if (sc === 'off') { if (g === 'click') Object.assign(ui, { screen: 'item', head: true }); }
    else if (sc === 'notice') { if (g === 'click') Object.assign(ui, { screen: 'item' }); if (g === 'double') ui.screen = 'off'; }
    else if (sc === 'item') {
      if (g === 'click' && f.top) open(f.top, 'item');
      else if (g === 'click' && f.done) ui.screen = 'off';
      else if (g === 'double') Object.assign(ui, { screen: 'off', head: false });
      else if (g === 'up' || g === 'down') toast(`眼镜上只给一件；另 ${f.open.length - (f.top ? 1 : 0)} 件在手机上`);
    } else if (sc === 'call') {
      const a = f.byId(ui.ctx.matched[0]);
      if (g === 'click' && a && !statusOf(a)) open(a, 'call');
      else if (g === 'double') ui.screen = 'off';
    } else if (sc === 'hangup') {
      const n = Math.min(2, ui.ctx.held.length);
      if (g === 'up' || g === 'down') ui.sel = Math.max(0, Math.min(n - 1, ui.sel + (g === 'down' ? 1 : -1)));
      else if (g === 'click') { const a = f.byId(ui.ctx.held[ui.sel]); if (a && !statusOf(a)) open(a, 'hangup'); }
      else if (g === 'double') ui.screen = 'off';
    } else if (sc === 'answer') {
      const a = f.byId(ui.subject), ch = choicesOf(a);
      if ((g === 'up' || g === 'down') && ch) ui.sel = Math.max(0, Math.min(ch.length - 1, ui.sel + (g === 'down' ? 1 : -1)));
      else if (g === 'click' && ch) {
        store.save(a.item, ch[ui.sel], { ask: a.raw, at: s.cursor });
        ui.screen = 'receipt';
        toast('已存 · 本页演示，不写回状态');
      } else if (g === 'double') Object.assign(ui, { screen: ui.from, sel: 0 });
    } else if (sc === 'receipt') {
      const a = f.byId(ui.subject);
      if (g === 'double') { const st = statusOf(a); if (st) store.removeKey(st.r.key); toast('已撤回'); Object.assign(ui, { screen: ui.from === 'off' ? 'item' : ui.from, sel: 0 }); }
      else if (g === 'click') Object.assign(ui, { screen: ui.from === 'item' ? 'off' : ui.from, sel: 0 });
    }
    render();
  }

  // ---------- images arrive one at a time, at the device's pace; text changes at once ----------
  const delivered = new Map();   // container name → the image as last sent {key, x, y, w, h, px}
  let queue = [], sending = null, page = [], log = [];
  let instant = Boolean(still) || reduced();
  function sync(next) {
    const names = new Set(next.filter(c => c.type === 'image').map(c => c.name));
    for (const name of [...delivered.keys()]) if (!names.has(name)) delivered.delete(name);
    queue = queue.filter(q => names.has(q.c.name));
    for (const c of next) {
      if (c.type !== 'image') continue;
      const key = imageKey(c);
      if (delivered.get(c.name)?.key === key) continue;
      if (instant) { queue = queue.filter(q => q.c.name !== c.name); delivered.set(c.name, { key, ...c }); continue; }
      if (queue.some(q => q.key === key) || sending?.key === key) continue;
      queue = queue.filter(q => q.c.name !== c.name);
      queue.push({ key, c });
    }
    pump();
  }
  function pump() {
    if (sending || !queue.length) return;
    sending = queue.shift();
    const ms = imageMs(sending.c.w, sending.c.h), t0 = performance.now();
    setTimeout(() => {
      const q = sending; sending = null;
      if (page.some(c => c.type === 'image' && c.name === q.c.name && imageKey(c) === q.key)) { delivered.set(q.c.name, { key: q.key, ...q.c }); log.push({ name: q.c.name, ms: Math.round(performance.now() - t0), w: q.c.w, h: q.c.h }); }
      draw(); pump();
    }, ms);
  }
  // An image container shows what was last sent to it while the same box is on screen; a new box is empty until it arrives.
  const shownOf = c => { const d = delivered.get(c.name); return d && d.x === c.x && d.y === c.y && d.w === c.w && d.h === c.h ? d : null; };

  // ---------- render ----------
  let scale = 1;
  function fit() {
    const holder = $('.gl-fig-display'), dpr = devicePixelRatio || 1, avail = Math.max(160, holder.clientWidth);
    const cap = Math.max(1, (innerHeight - 260) / H), fitS = Math.min(avail / W, Math.max(cap, 0.5)), whole = Math.floor(fitS * dpr) / dpr;
    scale = still ? 1 : whole >= 1 && whole / fitS > 0.85 ? whole : fitS;
    screenEl.style.width = `${Math.round(W * scale)}px`; screenEl.style.height = `${Math.round(H * scale)}px`;
    $('.gl-scale').textContent = `576 × 288 · 1:1 像素放大 ${Number.isInteger(scale * dpr) ? `${scale * dpr} 倍（整数）` : `${(scale * dpr).toFixed(2)} 倍`}`;
  }
  new ResizeObserver(fit).observe(wrapEl);
  function draw() {
    paint(px, page, shownOf);
    const scene = ui.ctx && (ui.screen === 'call' || ui.screen === 'hangup' || ui.from === 'call') ? 'street' : (h => (h >= 5 && h < 12 ? 'kitchen' : 'desk'))(F.hour(s.cursor));
    paintView(view, px, scene);
    $('.gl-scene').textContent = `${SCENE_WORDS[scene]} · 60° 镜头 · 显示区约 24.6° × 12.3°，在视线略上 · 绿光叠加在视野上`;
    const fold = page.filter(c => !c.sys), nT = fold.filter(c => c.type === 'text').length, nI = fold.filter(c => c.type === 'image').length;
    $('.gl-count').textContent = page.some(c => c.sys) ? '系统通知卡（来自手机通知，不占 Fold 的容器）' : `文本 ${nT} / 8 · 图片 ${nI} / 4 · 收手势 1${queue.length || sending ? ` · 图片送达中 ${queue.length + (sending ? 1 : 0)}` : ''}`;
  }
  const WHAT = {
    off: f => `眼镜不亮，0 像素${f.top ? `：最前那件“${f.top.short}”这一轮没换` : '：没有要紧的事'}`,
    notice: f => `整理落地，最前那件换成了“${(f.byId(f.push?.id) || f.top)?.short ?? ''}” → 手机通知，镜像到眼镜`,
    item: () => '抬头看一眼（Fold 在前台）',
    call: () => `你在和${ui.ctx.who}${ui.ctx.kind === 'call_log' ? '通话' : ui.ctx.kind === 'voicemail' ? '的留言里' : '的未接来电里'}：亮${ui.ctx.who}在等你的那一件`,
    hangup: () => `挂断了：通话时按住的 ${ui.ctx.held.length} 件出一次`,
    answer: () => '作答中：滑动换选，轻点确定',
    receipt: () => '已存，只在本页内存；下一轮整理读到才算收到',
  };
  function render() {
    s = model.snapshot();
    const f = facts();
    page = PAGES[ui.screen](f);
    sync(page); draw();
    $('.gl-when').textContent = `${F.day(s.cursor)} ${F.clock(s.cursor)} · ${s.frame.id}`;
    $('.gl-what').textContent = WHAT[ui.screen](f);
    $('[data-g="head"]').setAttribute('aria-pressed', String(ui.screen !== 'off'));
    $('[data-g="head"]').firstChild.textContent = ui.screen === 'off' ? '抬头' : '低头';
    $('.gl-now').style.left = pct(s.cursor);
    axis.querySelectorAll('.gl-round').forEach(b => b.classList.toggle('is-on', Number(b.dataset.k) === s.index));
    renderKeys();
  }
  function renderKeys() {
    keys.textContent = tour ? '正在讲一遍：整理落地 → 手机通知 → 打开 → 挑一项 → 已存 → 撤回 · 按任意键跳过'
      : 'Enter 轻点 · ⌫ 双击 · ↑↓ 滑动 · L 长按 · H 抬头 · [ ] 上一个 / 下一个时刻 · ←/→ 换整理时刻；显示面上也能直接点、滑、长按';
  }

  // ---------- input: buttons, keys, and touch on the display itself ----------
  const jumpMoment = dir => {
    const t = s.cursor, m = dir > 0 ? D.moments.find(x => x.t > t) : [...D.moments].reverse().find(x => x.t < t);
    if (m) model.setCursor(m.t);
  };
  stage.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (!b) return;
    // A pointer click leaves no focus behind, so Enter stays 轻点 (a keyboard Enter on a focused button still presses it).
    if (event.detail > 0) b.blur();
    if (b.dataset.g) press(b.dataset.g);
    else if (b.dataset.m) jumpMoment(Number(b.dataset.m));
    else if (b.dataset.k) model.goFrame(Number(b.dataset.k));
    else if (b.dataset.t) model.setCursor(Number(b.dataset.t));
    else if (b.dataset.x === 'replay') startTour();
  });
  let lHeld = 0;
  const onKey = event => {
    if (event.target.matches('input, textarea, select, [contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest?.('.fs-inspector')) return;
    const onButton = event.target.closest?.('button, a');
    if (event.key === 'Enter' && !onButton) { event.preventDefault(); press('click'); }
    else if (event.key === 'Backspace' || (event.key === 'Escape' && document.querySelector('.fs-inspector')?.hidden !== false)) { event.preventDefault(); press('double'); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); press(event.key === 'ArrowDown' ? 'down' : 'up'); }
    else if (event.key === 'h' || event.key === 'H') press('head');
    else if (event.key === ']') jumpMoment(1);
    else if (event.key === '[') jumpMoment(-1);
    else if ((event.key === 'l' || event.key === 'L') && !event.repeat) lHeld = performance.now();
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', event => { if ((event.key === 'l' || event.key === 'L') && lHeld) { if (performance.now() - lHeld >= 450) press('long'); lHeld = 0; } });
  // Touch / pointer on the display: a tap is 轻点 (two within 0.28 s are 双击), a vertical drag past 28 px is a swipe, 0.45 s still is 长按.
  let down = null, tapTimer = null;
  screenEl.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now(), long: setTimeout(() => { if (down) { down.done = true; press('long'); } }, 450) }; });
  screenEl.addEventListener('pointermove', e => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) clearTimeout(down.long); });
  screenEl.addEventListener('pointerup', e => {
    if (!down) return;
    clearTimeout(down.long);
    const d = down; down = null;
    if (d.done) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 28) { press(dy > 0 ? 'down' : 'up'); return; }
    if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; press('double'); return; }
    tapTimer = setTimeout(() => { tapTimer = null; press('click'); }, 280);
  });
  screenEl.addEventListener('pointercancel', () => { if (down) clearTimeout(down.long); down = null; });

  model.subscribe((next, info) => {
    s = next;
    if (info.type === 'frame' || info.type === 'init') landOn();
    render();
  });

  // ---------- 讲一遍 ----------
  const topLevel = (() => { try { return window.top === window; } catch { return false; } })();
  const loadedWith = new URL(performance.getEntriesByType?.('navigation')?.[0]?.name || location.href);
  const direct = topLevel && !document.referrer && !loadedWith.searchParams.has('frame') && !loadedWith.searchParams.has('at') && !still;
  const target = [...D.pushes].reverse().find(p => p.k <= formFrame) || D.pushes[0] || null;
  function endState() { store.clear(); model.goFrame(target.k); Object.assign(ui, { screen: 'item', head: true }); render(); }
  function startTour() {
    if (!target) return;
    stopTour();
    store.clear();
    model.goFrame(Math.max(0, target.k - 1));
    const answerable = Boolean(choicesOf(D.openAt(target.k, target.t).find(a => a.id === target.id)));
    const steps = [
      [900, () => model.goFrame(target.k)],
      [3300, () => press('click')],
      [5600, () => press('click')],
      ...(answerable ? [[6800, () => press('down')], [7900, () => press('click')], [9700, () => press('double')]] : []),
      [10600, () => stopTour()],
    ];
    tour = { timers: steps.map(([ms, fn]) => setTimeout(fn, ms)) };
    renderKeys();
  }
  function stopTour(skip = false) {
    if (!tour) return;
    tour.timers.forEach(clearTimeout);
    tour = null;
    if (skip) { const was = instant; instant = true; endState(); instant = was; }
    renderKeys();
  }
  window.addEventListener('keydown', event => { if (!tour) return; event.preventDefault(); event.stopImmediatePropagation(); stopTour(true); }, true);
  window.addEventListener('pointerdown', event => { if (tour && !event.target.closest?.('[data-x="replay"]')) stopTour(true); }, true);
  $('.gl-replay').hidden = !topLevel || !target;

  // ?still=boxes: the page at 2× with every container outlined and named (文 = text, 图 = image, c = textColor, ◉ = events).
  function annotate() {
    const c = Object.assign(document.createElement('canvas'), { width: W * 2, height: H * 2 }), x = c.getContext('2d');
    x.imageSmoothingEnabled = false; x.drawImage(px, 0, 0, W * 2, H * 2);
    x.font = `13px ${SANS}`; x.textBaseline = 'top';
    let t = 0, i = 0;
    for (const k of page) {
      if (k.ev && !k.text.trim()) continue;
      const img = k.type === 'image', label = k.sys ? '系统' : img ? `图${++i} ${k.w}×${k.h}` : `文${++t} c${k.c}${k.bw ? ` b${k.bw}` : ''}`;
      x.strokeStyle = img ? 'rgba(255,200,90,.9)' : 'rgba(200,210,255,.85)'; x.setLineDash([4, 3]); x.lineWidth = 1;
      x.strokeRect(k.x * 2 + 0.5, k.y * 2 + 0.5, k.w * 2 - 1, k.h * 2 - 1); x.setLineDash([]);
      x.fillStyle = img ? 'rgba(255,200,90,.95)' : 'rgba(200,210,255,.95)';
      const below = k.y * 2 + k.h * 2 + 2;
      if (!(k.sys && k.name !== 'card')) x.fillText(k.sys ? '系统通知卡（手机通知，不占 Fold 的容器）' : label, k.x * 2 + 3, below > H * 2 - 16 ? k.y * 2 - 15 : below);
    }
    const n = window.foldGlasses.counts();
    x.fillStyle = 'rgba(255,255,255,.75)'; x.fillText(n.sys ? '' : `文本 ${n.text} / 8 · 图片 ${n.image} / 4 · 收手势 ${n.events}（隐藏的全屏文本容器）`, 8, H * 2 - 18);
    screenEl.replaceChildren(c);
    Object.assign(screenEl.style, { width: `${W * 2}px`, height: `${H * 2}px` });
  }

  // ---------- hooks (scripts/check-ix.mjs, stills) ----------
  window.foldGlasses = {
    model,
    get index() { return s.index; },
    go: i => model.goFrame(i),
    at: t => model.setCursor(t),
    press,
    screen: () => ui.screen,
    page: () => page.map(c => ({ ...c, px: c.px ? [...new Set(c.px)].sort((a, b) => a - b) : undefined })),
    counts: () => { const fold = page.filter(c => !c.sys); return { text: fold.filter(c => c.type === 'text').length, image: fold.filter(c => c.type === 'image').length, events: fold.filter(c => c.ev).length, sys: page.some(c => c.sys) }; },
    lit: () => { const d = px.getContext('2d').getImageData(0, 0, W, H).data; let n = 0; for (let i = 1; i < d.length; i += 4) if (d[i] > 0) n += 1; return n; },
    text: () => page.filter(c => c.type === 'text').map(c => c.text).join('\n'),
    facts: () => { const f = facts(); return { cursor: s.cursor, open: f.open.length, urgent: f.urgent.map(a => a.id), top: f.top?.id ?? null, topDue: f.top?.due ?? null, push: f.push?.id ?? null,
      shorts: f.open.map(a => a.short), labels: f.open.flatMap(a => a.ask.actions.map(x => x.label)) }; },
    pushes: () => D.pushes.map(p => ({ ...p, frame: D.frames[p.k].id })),
    calls: () => D.calls.map(c => ({ ...c })),
    moments: () => D.moments.map(m => ({ ...m })),
    records: () => store.list(),
    pending: () => queue.length + (sending ? 1 : 0),
    imageLog: () => log.slice(),
    settle: () => new Promise(r => { const go = () => (queue.length || sending ? setTimeout(go, 30) : r(true)); go(); }),
    telling: () => Boolean(tour),
    datasetHref: href => withDataset(href),
  };

  landOn();
  render();
  fit();
  for (const g of (params.get('press') || '').split(',').filter(Boolean)) {
    if (g === 'next' || g === 'prev') model.goFrame(s.index + (g === 'next' ? 1 : -1)); else press(g);
  }
  if (still === 'boxes') annotate();
  if (direct && !reduced()) startTour();
}
