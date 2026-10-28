// 11 结绳（第四轮候选 06）：层级份额与分组合计。一根粗主绳是根层的 64 份，每根垂绳是一件事，结按数位对齐成两道横带：
// 靠主绳的一带是十位（一颗单结十份），下一带是个位（长结的圈数，1 是 8 字结）。有子层的垂绳下端挂一根短横绳，那是
// 这件事自己的 64 份，副绳挂在它下面，各有自己的结与“≈ 折合根层”的份数；主绳上方的合计绳是一组事的和；虚线绳是留白。
// 只用墨黑，绳的粗细只分层级；朱红只给此刻开着的问题。平涂线与几何结，不画绳的质感。
//
// 动起来（polish/khipu-motion.md）：换轮时各绳滑到新位置，份额变了的结先退成灰、再一圈圈绕上（概念层），落定时转墨、
// 数字硬切；根层份额变了的那根绳，一颗灰珠沿绳往下走到每根副绳，经过“≈”时那个数硬切。点开有子层的垂绳，它下端的
// 短横绳长成子层画框的主绳（借 View Transitions：同一根绳位置连续），根层缩成顶上一条窄带。
//   讲一遍：只在顶层直接打开、地址不带 ?frame=、也不是从别的页面链过来时演一次（只有手写情境有三拍，约 9 秒，
//     停在 f26 的发布画框里），任意键跳过；工具栏的「▶ 讲一遍」可重演。带 ?frame=、嵌在画廊或合页里的一律静止。
//   连播（空格）每轮约 1 秒（半速）；←/→ 逐帧用 0.9 秒的短版；往回退与一次跳多帧只滑位置、数字直接到终态。
// 交互接共用模块 motion/ix.mjs：悬停出概要卡，点击沿绳往下弹出 8 px，引线接详情卡，侧栏切到“这一件”；卡上的
// “去回答 →”只给此刻开着的问题，链到同一帧的 D。只读回放，帧号是本页常量，不改数据。composite 两周没有子层，
// 只画根层与分组合计，并在图里写明。
import {
  createStage, esc, frames, records, dayTime, shortOf, titleAt, responsesIn, askById, itemDetailHTML,
  kindWord, reduced, foldSentences, askLife, rootOf, responseSentence,
} from './stage.mjs';
import { createIx, IX } from '../motion/ix.mjs';
import { dueText } from '../motion/dial-model.mjs';
import { withDataset, currentDataset } from '../../data/select.mjs';

const LAST = frames.length - 1;
const DATA = currentDataset();
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - (1 - clamp(k)) ** 3;
const easeInOut = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
// Fast start, settles with an overshoot of about 3.7 % (the dial's curve).
const easeOutBack = k => { const u = clamp(k) - 1; return 1 + 2 * u ** 3 + u ** 2; };
const indexOfId = id => frames.findIndex(frame => frame.id === id);
const now = () => performance.now() / 1000;
// The sketch palette (sketches.css) in sRGB, for the canvas.
const C = { paper: '#f8f7f2', ink: '#1a251d', ink2: '#555d56', ink3: '#8e948d', line: '#d8d8d1', faint: '#e8e8e2', red: '#da4620' };
const GREY = a => `rgba(120,128,118,${a.toFixed(3)})`;
const SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// ---------- the story: frame ids are page constants (polish/khipu-motion.md 第 3 节) ----------
// 手写情境：从 f24 起，f25 发布 6 → 24（根层四倍，再走一遍折合），f26 换轮后长出发布的子层画框，停 1.5 秒。
// composite 两周没有子层：不讲，停在 f26。
const PLAN = { story: { from: 'f24', steps: [['post', 'f25', 0.8], ['post', 'f26', 0.3], ['drill', 'launch'], ['hold', 1.5]] } };
const DEFAULT_FRAME = { composite: 'f26', story: 'f26' };
const plan = (() => {
  const p = PLAN[DATA];
  if (!p) return null;
  const from = indexOfId(p.from);
  const steps = p.steps.map(([type, a, b]) => (type === 'post' ? { type, i: indexOfId(a), extra: b || 0 } : type === 'drill' ? { type, id: a } : { type, dur: a }));
  const posts = steps.filter(s => s.type === 'post');
  const ok = from >= 0 && posts.every((s, k) => s.i === (k ? posts[k - 1].i : from) + 1);
  return ok ? { from, steps, end: posts.at(-1).i, drill: steps.find(s => s.type === 'drill')?.id || null } : null;
})();
const fromElsewhere = (() => { try { return Boolean(document.referrer) && new URL(document.referrer).pathname !== location.pathname; } catch { return false; } })();
const params = new URLSearchParams(location.search);
const autoTell = Boolean(plan) && window.parent === window && !params.has('frame') && !fromElsewhere;
if (autoTell) { params.set('frame', plan.from); history.replaceState(null, '', `?${params}`); }
else if (!params.has('frame') && indexOfId(DEFAULT_FRAME[DATA] || '') >= 0) { params.set('frame', indexOfId(DEFAULT_FRAME[DATA])); history.replaceState(null, '', `?${params}`); }

const knotKey = `<svg width="54" height="22" viewBox="0 0 54 22"><line x1="1" x2="53" y1="2.5" y2="2.5" stroke="var(--ink)" stroke-width="3"/><line x1="14" x2="14" y1="2" y2="22" stroke="var(--ink)" stroke-width="1.6"/><line x1="40" x2="40" y1="2" y2="22" stroke="var(--ink)" stroke-width="1.6"/><circle cx="14" cy="9" r="2.6" fill="var(--ink)"/><rect x="36.5" y="6" width="7" height="13" rx="3" fill="var(--ink)"/><line x1="37" x2="43" y1="10.3" y2="10.3" stroke="var(--paper)" stroke-width=".8"/><line x1="37" x2="43" y1="14.6" y2="14.6" stroke="var(--paper)" stroke-width=".8"/></svg>`;
const key = `
  <span>${knotKey}主绳 = 根层 64 份；垂绳 = 一件事；靠主绳的单结是十位，下一带长结的圈数是个位（1 是 8 字结）</span>
  <span><svg width="30" height="14"><line x1="15" x2="15" y1="0" y2="5" stroke="var(--ink)" stroke-width="1.6"/><line x1="4" x2="26" y1="5" y2="5" stroke="var(--ink)" stroke-width="1.6"/><line x1="7" x2="7" y1="5" y2="14" stroke="var(--ink)" stroke-width="1"/><line x1="23" x2="23" y1="5" y2="14" stroke="var(--ink)" stroke-width="1"/></svg>短横绳挂着这件事自己的 64 份；≈ 折合根层 = 父件折合 × 份数 ÷ 64</span>
  <span><svg width="26" height="12"><line x1="1" x2="25" y1="3" y2="3" stroke="var(--ink)" stroke-width="1.6"/><line x1="6" x2="6" y1="3" y2="12" stroke="var(--ink-3)" stroke-dasharray="1.5 1.5"/><line x1="20" x2="20" y1="3" y2="12" stroke="var(--ink-3)" stroke-dasharray="1.5 1.5"/></svg>合计绳 = 一组的和</span>
  <span><svg width="10" height="14"><line x1="5" x2="5" y1="0" y2="14" stroke="var(--ink-3)" stroke-width="1.4" stroke-dasharray="3 2"/></svg>留白</span>
  <span><i class="k-key-ask"></i>此刻开着的问题</span>
  <span><i class="k-key-grey"></i>换轮时打结、折合，落定后不留</span>
  <span class="note"><kbd>←</kbd><kbd>→</kbd> 逐帧 <kbd>空格</kbd> 连播 <kbd>Enter</kbd> 展开 <kbd>Esc</kbd> 收回</span>`;
const dataHref = DATA === 'story' ? 'khipu.html?data=composite' : 'khipu.html?data=story';
const stage = createStage({
  id: 'khipu', no: 11, name: '结绳', storyIndex: Math.max(0, indexOfId(DEFAULT_FRAME.story)), key,
  relation: '层级份额与分组合计：一件事里还有自己的 64 份，子层里的一份要乘着上面每一层才折合成根层；合计绳是一组事的和。',
  tools: `${plan ? '<button type="button" class="k-tell" data-k="tell" title="从头讲一遍（任意键跳过）">▶ 讲一遍</button>' : ''}<a class="k-data" data-k="data" href="${esc(dataHref)}" title="换一个数据集">${DATA === 'story' ? '真实语料（没有子层）→' : '看手写情境的子层 →'}</a>`,
});
document.querySelector('.st-kicker').textContent = 'FOLD · 第四轮 · 关系的画法';
const figure = stage.figure;

// ---------- data: groups, layers, the conversion to root shares ----------
// A root item's group comes from the inputs it was built from (every version's sources, over the whole replay, so it
// never changes mid-way): composite reads the event's stream; the hand-written story has no streams, so its channels
// are sorted by name (the person's own messages and official material do not count).
const eventIndex = new Map();
for (const frame of frames) for (const event of frame.events) eventIndex.set(event.id, event);
const LANES = [['family', /家人/], ['work', /团队|客户|监控|部署|反馈|合作|招聘|供应商|财务/], ['life', /物业|同楼|团购|快递|随手记|日历|定时/]];
const laneOf = (event, channel) => {
  if (event?.stream) return event.stream;
  const head = String(event?.channel || channel || '').split(' · ')[0];
  return LANES.find(([, re]) => re.test(head))?.[0] || null;
};
const GROUP_OF = { work: '工作', community: '工作', family: '家里与生活', life: '家里与生活' };
const GROUPS = ['工作', '家里与生活', '其余'];
const groupOf = (() => {
  const counts = new Map(), seen = new Set();
  for (const record of records) for (const item of Object.values(record.snapshot.items)) {
    const version = `${item.id}@${item.updated_at}`;
    if (seen.has(version)) continue;
    seen.add(version);
    const root = rootOf(item.id);
    for (const source of item.sources || []) {
      const event = source.ref?.startsWith('event:') ? eventIndex.get(source.ref.slice(6)) : null;
      const group = GROUP_OF[laneOf(event, source.channel)];
      if (!group) continue;
      const m = counts.get(root) || {};
      m[group] = (m[group] || 0) + 1;
      counts.set(root, m);
    }
  }
  const out = new Map();
  for (const [id, m] of counts) out.set(id, Object.entries(m).sort((a, b) => b[1] - a[1] || GROUPS.indexOf(a[0]) - GROUPS.indexOf(b[0]))[0][0]);
  return id => out.get(rootOf(id)) || '其余';
})();
const firstSeen = new Map();
records.forEach((record, i) => Object.values(record.snapshot.items).forEach((item, k) => { if (!firstSeen.has(item.id)) firstSeen.set(item.id, i * 1000 + k); }));
const bySize = (a, b) => b.share - a.share || (firstSeen.get(a.id) ?? 0) - (firstSeen.get(b.id) ?? 0);
const digits = n => ({ t: Math.floor(Math.max(0, n) / 10), u: Math.max(0, n) % 10 });
const effText = e => (e >= 1 ? (Math.round(e * 10) / 10).toFixed(1) : (Math.round(e * 100) / 100).toFixed(2));

const treeCache = new Map();
/** The whole khipu of frame i: every layer, each item's share in its own layer and its root equivalent. */
function treeOf(i) {
  if (treeCache.has(i)) return treeCache.get(i);
  const state = records[i].state, byKey = new Map();
  const root = { key: 'root', id: null, level: -1, share: 64, eff: 64, used: state.root.used, kids: [], parent: null };
  const build = (layer, parent, level) => (layer?.items || []).map(item => {
    const n = { key: `p:${item.id}`, id: item.id, item, level, parent, share: item.share, eff: (parent.eff * item.share) / 64,
      used: item.children?.used || 0, kids: [], group: groupOf(item.id) };
    n.kids = build(item.children, n, level + 1).sort(bySize);
    byKey.set(n.key, n);
    return n;
  });
  root.kids = build(state.root, root, 0).sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || bySize(a, b));
  const asks = new Map();
  for (const a of askLife[i].open.values()) { if (!asks.has(a.item)) asks.set(a.item, []); asks.get(a.item).push(a); }
  const all = [...byKey.values()];
  const depth = all.length ? Math.max(...all.map(n => n.level)) : -1;
  const deep = depth >= 1 ? all.filter(n => n.level === depth).sort((a, b) => a.eff - b.eff || bySize(a, b)) : [];
  const hero = deep.length ? deep.filter(n => Math.abs(n.eff - deep[0].eff) < 1e-9) : [];
  const groups = GROUPS.map(g => ({ g, members: root.kids.filter(n => n.group === g) })).filter(x => x.members.length)
    .map(x => ({ ...x, sum: x.members.reduce((s, n) => s + n.share, 0) }));
  const tree = { i, root, byKey, asks, depth, hero, groups, blank: 64 - state.root.used, layered: root.kids.filter(n => n.kids.length) };
  treeCache.set(i, tree);
  return tree;
}
const anyLayers = frames.some((_, i) => treeOf(i).layered.length);
const nodeAt = (i, key) => treeOf(i).byKey.get(key) || null;
const hasLayer = (i, id) => Boolean(nodeAt(i, `p:${id}`)?.kids.length && nodeAt(i, `p:${id}`).level === 0);
const pathOf = n => { const out = []; for (let x = n; x && x.level >= 0; x = x.parent) out.unshift(x); return out; };
const nameOf = n => (n.level === 0 ? shortOf(n.id) : clip(n.item.title.split(/[，,。；;（(]/)[0], 10));
const clip = (text, k) => ([...String(text)].length > k ? `${[...String(text)].slice(0, k - 1).join('')}…` : String(text));
const chainText = (n, k0 = 10) => pathOf(n).map((x, k) => (k ? `${clip(firstClause(x.item.title), k0)} ${x.share}/64` : `${shortOf(x.id)} ${x.share}`)).join(' × ');
/** A node's share in every frame (0 where it is absent), and its root equivalent. */
const seriesOf = (key, field = 'share') => frames.map((_, i) => nodeAt(i, key)?.[field] || 0);

// ---------- text measuring on the canvas ----------
let ctx = null;
const measureCtx = document.createElement('canvas').getContext('2d');
const fontOf = (size, weight = 400, mono = false) => `${weight} ${size}px ${mono ? MONO : SANS}`;
const widthOf = (text, size, weight = 400, mono = false) => { measureCtx.font = fontOf(size, weight, mono); return measureCtx.measureText(text).width; };
function fitText(text, width, size, weight) {
  if (widthOf(text, size, weight) <= width) return text;
  const chars = [...text];
  while (chars.length > 1 && widthOf(`${chars.join('')}…`, size, weight) > width) chars.pop();
  return `${chars.join('')}…`;
}

// ---------- geometry: one scene per frame and view ----------
// Every layer is drawn the same way: a horizontal cord with a row of pendants. Rank is the depth below the top layer on
// screen (the root, or the opened item's own layer inside the frame); ranks only scale the knots and the type. The cord's
// thickness belongs to its level and never scales: main cord 3.2, root pendants and their short bars 1.8, children 1.1,
// grandchildren 0.8. The bands leave room for six single knots and a nine-turn long knot whatever the round holds (no
// cord can hold more than 64), so the rows never move from one round to the next.
// Root pendants carry their names across; every cord below the root is named downwards, the way a tag hangs (CJK upright,
// Latin and digits turned on their side), so narrow slots still read and a name keeps its form when its layer is opened.
const G = { LX: 104, RP: 14, top: 44, main: 92, gap: 8, groupGap: 22, stagger: 15, strip: 18, stub: 18, frameTop: 62, sub: 130 };
const SCALE = anyLayers ? [1.15, 0.85, 0.7] : [1.45];
// With no layers anywhere (composite) a round holds up to 26 root cords and the whole height is free: their names hang too.
const ROOT_DOWN = !anyLayers;
const noteTop = () => { const P = geo(0, true); return Math.round(G.main + P.nameTop + 9 * P.lineH + 28); };
const NAME = [13, 10.5, 10], NUM = [12.5, 10.5, 9.5];
/** Offsets below the cord a rank hangs from; `down` is a layer whose names hang downwards. */
function geo(rank, down) {
  const r = Math.min(rank, 2), s = SCALE[Math.min(rank, SCALE.length - 1)];
  const tensTop = 12 * s, tensH = 54 * s, unitsTop = tensTop + tensH + 8 * s, unitsH = 32.8 * s;
  const P = { s, tens: tensTop + tensH / 2, units: unitsTop + unitsH / 2, end: unitsTop + unitsH + 6 * s, num: NUM[r] * (s > 1.3 ? 1.12 : 1) };
  P.name = down ? (rank ? NAME[r] : s > 1.3 ? 13.5 : 12) : NAME[0] * (s > 1.3 ? 1.1 : 1);
  P.weight = rank || down ? 500 : 600;
  if (down) {
    P.eff = P.end + 12; P.nameTop = P.eff + 9; P.lineH = P.name + 1.5;
    P.bar = P.nameTop + 7 * P.lineH + 6;
  } else {
    P.label = P.end + 16; P.pill = P.label + 20; P.bar = P.pill + 24;
  }
  return P;
}
const WIDTH = [1.8, 1.1, 0.8, 0.7];
const leafCount = n => (n.kids?.length ? n.kids.reduce((s, c) => s + leafCount(c), 0) : 1);
let W = 0, H = 0;
const sceneCache = new Map();
/** The scene of frame i: the root khipu (view null) or the root shrunk to a strip and item `view`'s layer in a frame. */
function sceneOf(i, view) {
  const ck = `${i}|${view || ''}`;
  if (sceneCache.has(ck)) return sceneCache.get(ck);
  const tree = treeOf(i), S = { i, view, nodes: new Map(), order: [], bars: new Map(), tops: [], guides: [], left: [], main: null, frame: null, header: null };
  const xa = G.LX, xb = W - G.RP;
  const open = view ? tree.byKey.get(`p:${view}`) : null;
  const rootList = [...tree.root.kids, { blank: true, key: 'blank', share: tree.blank, level: 0, kids: [] }];
  const mainY = open ? G.strip : G.main;
  S.main = { x0: xa - 8, x1: xb + 6, y: mainY, w: 3.2 };
  if (!open) {
    layLayer(S, tree, rootList, xa, xb, G.main, 0, { pills: true, chars: ROOT_DOWN ? 9 : 8 });
    // Summary cords: one per group, above the main cord, tied to its members.
    for (const g of tree.groups) {
      const xs = g.members.map(n => S.nodes.get(n.key).x);
      S.tops.push({ key: `top:${g.g}`, g: g.g, x0: Math.min(...xs) - 10, x1: Math.max(...xs) + 10, y: G.top, ties: xs, sum: g.sum, members: g.members.map(n => n.key) });
    }
    S.left.push({ text: '根层 64', x: xa - 14, y: G.main + 4, size: 12, weight: 600 }, { text: `用了 ${64 - tree.blank} · 留白 ${tree.blank}`, x: xa - 14, y: G.main + 18, size: 10.5, color: C.ink2 });
    if (tree.groups.length) S.left.push({ text: '合计绳', x: xa - 14, y: G.top + 4, size: 10.5, color: C.ink2 });
    bandGuides(S, G.main, maxRank(tree.root.kids, 0), false);
  } else {
    // The strip: the same x as in the root view, every pendant a stub with its number; the opened one hangs into the frame.
    layLayer(S, tree, rootList, xa, xb, mainY, 0, { strip: true, open: open.key });
    S.left.push({ text: '根层 64', x: xa - 14, y: mainY + 4, size: 11, weight: 600 }, { text: `用了 ${64 - tree.blank} · 留白 ${tree.blank}`, x: xa - 14, y: mainY + 17, size: 9.5, color: C.ink2 });
    const fy = G.frameTop, subY = G.sub, cordX = S.nodes.get(open.key).x;
    S.frame = { x0: 4, y0: fy, x1: W - 4, y1: H - 6 };
    const unit = open.eff / 64;
    const title = `${shortOf(open.id)} · 根层 ${open.share} / 64`, sub = `它自己的 64 份：用了 ${open.used} · 留白 ${64 - open.used} · 这一层的一份折合根层 ${effText(unit)} 份`;
    // The header sits beside the opened cord where it passes through the frame, never across it.
    const wide = widthOf(title, 13, 600) + 12 + widthOf(sub, 11.5);
    const hx = cordX + 14 + wide < W - 16 ? cordX + 14 : Math.max(104, cordX - 14 - wide);
    S.header = { x: hx, y: fy + 25, title, sub };
    const subList = [...open.kids, { blank: true, key: `blank:${open.id}`, share: 64 - open.used, level: 1, kids: [] }];
    S.bars.set(`bar:${open.id}`, { key: `bar:${open.id}`, owner: open.key, x0: xa - 8, x1: xb + 6, y: subY, w: WIDTH[0] });
    layLayer(S, tree, subList, xa, xb, subY, 0, { frame: true, chars: 12 });
    S.left.push({ text: `${shortOf(open.id)}的子层 64`, x: xa - 14, y: subY + 4, size: 11.5, weight: 600 }, { text: `用了 ${open.used} · 留白 ${64 - open.used}`, x: xa - 14, y: subY + 18, size: 10, color: C.ink2 });
    bandGuides(S, subY, maxRank(open.kids, 0), true);
  }
  sceneCache.set(ck, S);
  return S;
}
const maxRank = (list, r) => Math.max(r, ...list.map(n => (n.kids?.length ? maxRank(n.kids, r + 1) : r)));
function bandGuides(S, attachY, r1, inFrame) {
  let y = attachY;
  const names = inFrame ? ['子层 · 十位', '子层 · 个位', '再下一层 · 十位', '再下一层 · 个位'] : ['十位 · 单结', '个位 · 长结', '子层 · 十位', '子层 · 个位', '子子层 · 十位', '子子层 · 个位'];
  for (let r = 0; r <= Math.min(r1, 2); r += 1) {
    const P = geo(r, inFrame || r > 0);
    for (const [k, dy] of [[0, P.tens], [1, P.units]]) {
      S.guides.push({ y: y + dy, x0: G.LX - 4, x1: W - G.RP + 4 });
      S.left.push({ text: names[r * 2 + k] || '', x: G.LX - 14, y: y + dy + 3, size: 9.5, mono: true, color: C.ink3 });
    }
    y += P.bar;
  }
}
/** Lay one layer (a list of nodes) across [xa, xb] hanging from attachY, slots by leaf count. */
function layLayer(S, tree, list, xa, xb, attachY, rank, opts) {
  const leaves = list.map(n => (n.blank ? 1 : leafCount(n)));
  const total = leaves.reduce((a, b) => a + b, 0) || 1;
  const gaps = list.map((n, k) => (!k ? 0 : rank === 0 && !opts.frame && (n.blank || n.group !== list[k - 1].group) ? G.groupGap : rank === 0 ? G.gap : 4));
  const unit = (xb - xa - gaps.reduce((a, b) => a + b, 0)) / total;
  const down = Boolean(opts.frame) || rank > 0 || (ROOT_DOWN && !opts.strip);
  const P = geo(rank, down);
  let x = xa;
  const slots = list.map((n, k) => { x += gaps[k]; const s = { x0: x, x1: x + leaves[k] * unit }; x = s.x1; return s; });
  const names = list.map((n, k) => labelText(n, opts, slots[k], P, down));
  // Root names too wide for their slot alternate between two rows.
  const stagger = !opts.strip && !down && list.some((n, k) => widthOf(names[k], P.name, P.weight) > slots[k].x1 - slots[k].x0 - 4 && !n.kids?.length);
  list.forEach((n, k) => placeNode(S, tree, n, slots[k], attachY, rank, opts, stagger && k % 2 ? G.stagger : 0, names[k], P, down));
}
const firstClause = title => String(title).split(/[，,。；;：:（(]/)[0];
function labelText(n, opts, slot, P, down) {
  if (opts.strip) return n.blank ? `留白 ${n.share}` : n.key === opts.open ? `${shortOf(n.id)} ${n.share}` : String(n.share);
  if (n.blank) return '留白';
  if (!down) return fitText(n.level === 0 ? shortOf(n.id) : firstClause(n.item.title), Math.max(24, (slot.x1 - slot.x0) * 2 - 6), P.name, P.weight);
  // Downwards: a leaf hangs its name under the cord; a cord with its own layer runs it beside the cord, above its bar.
  const room = n.kids?.length ? Math.floor((P.bar - P.nameTop - 8) / P.lineH) : opts.chars || 8;
  return fitDown(n.level === 0 ? shortOf(n.id) : firstClause(n.item.title), room, P.name);
}
function placeNode(S, tree, n, slot, attachY, rank, opts, drop, name, P, down) {
  const x = (slot.x0 + slot.x1) / 2, level = n.level;
  const node = { key: n.key, kind: n.blank ? 'blank' : 'cord', id: n.id || null, level, rank, x, y0: attachY, s: P.s,
    w: WIDTH[Math.min(level, WIDTH.length - 1)], tensY: attachY + P.tens, unitsY: attachY + P.units, n: n.share, slot, dashed: Boolean(n.blank),
    asks: n.blank ? 0 : (tree.asks.get(n.id) || []).length, eff: null, pill: null, num: null, label: null, parent: n.parent?.key || null, bottom: 0 };
  if (opts.strip) {
    const opened = n.key === opts.open;
    node.s = 0; node.tensY = attachY + 10; node.unitsY = attachY + 14; node.asks = 0;
    node.y1 = opened ? G.sub : attachY + G.stub;
    node.label = { text: name, x, y: attachY + 32, size: opened ? 11 : 10, weight: opened ? 600 : 400, mono: !opened, color: opened ? C.ink : C.ink2, bg: opened };
    node.bottom = attachY + 36;
    S.nodes.set(node.key, node); S.order.push(node.key);
    return;
  }
  const kids = n.kids?.length ? n.kids : [];
  node.num = { text: String(n.share), x: x + 8 * P.s + 1, y: node.tensY + 4, size: P.num };
  if (down) {
    const beside = kids.length > 0;
    node.label = { text: name, x: beside ? x + 5 : x, y: attachY + P.nameTop, size: P.name, weight: level === 0 ? 600 : P.weight, color: n.blank ? C.ink2 : C.ink, down: true, beside };
    if (level >= 1 && !n.blank) node.eff = { text: `≈${effText(n.eff)}`, x, y: attachY + P.eff, size: Math.max(9, P.num - 1) };
  } else {
    node.label = { text: name, x, y: attachY + P.label + drop, size: P.name, weight: P.weight, color: n.blank ? C.ink2 : C.ink, bg: kids.length > 0 };
    if (kids.length && opts.pills) node.pill = { text: `子层 ${n.used}/64 ↘`, x, y: attachY + P.pill };
  }
  S.nodes.set(node.key, node); S.order.push(node.key);
  if (kids.length && rank < 2) {
    const barY = attachY + P.bar;
    node.y1 = barY;
    layLayer(S, tree, kids, slot.x0, slot.x1, barY, rank + 1, { ...opts, pills: false });
    const xs = kids.map(c => S.nodes.get(c.key).x);
    if (!S.bars.has(`bar:${n.id}`)) S.bars.set(`bar:${n.id}`, { key: `bar:${n.id}`, owner: n.key, x0: Math.min(...xs, x), x1: Math.max(...xs, x), y: barY, w: node.w });
    node.bottom = Math.max(...kids.map(c => S.nodes.get(c.key).bottom));
  } else {
    node.y1 = attachY + P.end;
    node.bottom = down ? node.label.y + downLength(node.label.text, node.label.size) + 2 : node.label.y + 4;
  }
}

// ---------- names that hang downwards: CJK upright, runs of Latin and digits on their side ----------
const runsOf = str => String(str).match(/[\x21-\x7e…]+|\s+|[^\x21-\x7e\s…]/gu) || [];
const isSide = run => /^[\x21-\x7e…]+$/.test(run);
/** How long a name is when it hangs downwards at this size. */
function downLength(str, size) {
  let L = 0;
  for (const run of runsOf(str)) L += isSide(run) ? widthOf(run, size * 0.92) + 1 : /^\s+$/.test(run) ? size * 0.4 : size + 1.5;
  return L;
}
/** The name cut to at most `chars` upright characters' worth of length, with an ellipsis. */
function fitDown(str, chars, size) {
  const max = chars * (size + 1.5);
  if (downLength(str, size) <= max) return str;
  const all = [...String(str)];
  while (all.length > 1 && downLength(`${all.join('')}…`, size) > max) all.pop();
  return `${all.join('')}…`;
}
// ---------- the clock: one transition at a time ----------
// A post is one round: positions move, changed knots untie and tie again (grey), the numbers settle, the conversion
// bead runs down the layers. Full speed when telling, half when playing, a short version for ←/→, a plain one (no
// grey) for going back or jumping. A drill is the frame growing out of a pendant, or shrinking back into it.
const FULL = { move0: 0.40, moveDur: 0.45, untie0: 0.85, untieDur: 0.15, tie0: 1.00, settle: 1.50, bead0: 1.60, beadStep: 0.35, trail: 0.15, rest: 0.6 };
const SHORT = { move0: 0, moveDur: 0.25, untie0: 0.25, untieDur: 0.07, tie0: 0.32, settle: 0.50, bead0: 0.52, beadStep: 0.15, trail: 0.1, rest: 0.3 };
const PLAIN = { move0: 0, moveDur: 0.25, untie0: 0.12, untieDur: 0, tie0: 0.12, settle: 0.12, bead0: 0.12, beadStep: 0, trail: 0, rest: 0.15, plain: true };
function timing(mode) {
  if (mode === 'short') return SHORT;
  if (mode === 'back' || mode === 'sweep' || mode === 'snap') return PLAIN;
  if (mode === 'half') return Object.fromEntries(Object.entries(FULL).map(([k, v]) => [k, v * 0.5]));
  return FULL;
}
let tr = null;                // {kind: 'post' | 'drill', A, B, t, T, dur, extra, i, mode, beads, arrive}
let freeze = false;           // tellAt(): a still, until any control releases it
const hold = { at: null };    // ix pauses the clock while something is hovered or open
let driving = null;           // set while the page itself steps (telling, playing)
const run = { kind: null, k: -1, wait: 0 };
let view = null;              // the item whose layer is drawn in the frame, or null for the root khipu

function startPost(prev, next, mode, extra = 0) {
  const T = timing(mode);
  const A = sceneOf(prev, view), B = sceneOf(next, view);
  tr = { kind: 'post', A, B, t: 0, T, mode, extra, i: next, settled: false };
  tr.beads = T.plain ? [] : beadsFor(A, B, T);
  tr.arrive = new Map();
  let last = T.settle;
  for (const b of tr.beads) for (const [k, at] of b.arrive) { tr.arrive.set(k, at); last = Math.max(last, at + T.trail); }
  tr.dur = last + T.rest + extra;
  tr.heroAt = heroArrival(next, tr);
  if (reduced()) tr.t = tr.dur;
}
function startDrill(i, from, to) {
  tr = { kind: 'drill', A: sceneOf(i, from), B: sceneOf(i, to), t: 0, dur: to ? 0.55 : 0.45, i, rising: !to };
  if (reduced()) tr.t = tr.dur;
}
const live = () => Boolean(tr && tr.t < tr.dur);
const postLive = () => Boolean(tr && tr.kind === 'post' && tr.t < tr.T.settle);
function finishTransition() { if (tr) tr.t = tr.dur; tr = null; dirty = true; }

// The conversion bead: from a pendant whose share changed (and whose layer is drawn) down to every cord under it.
function beadsFor(A, B, T) {
  const out = [];
  for (const key of B.order) {
    const a = A.nodes.get(key), b = B.nodes.get(key);
    if (!a || !b || a.n === b.n || b.kind !== 'cord' || !B.bars.has(`bar:${b.id}`)) continue;
    const startY = b.s ? b.unitsY + knotHalfH(b.n, b.s) + 3 : b.y0 + 20;
    const arrive = new Map(), paths = [];
    const walk = (parent, from, depth) => {
      const bar = B.bars.get(`bar:${parent.id}`);
      if (!bar) return;
      for (const key2 of B.order) {
        const c = B.nodes.get(key2);
        if (c.parent !== parent.key) continue;
        const end = { x: c.x, y: c.eff ? c.eff.y - 9 : c.y1 };
        const pts = [from, { x: from.x, y: bar.y }, { x: c.x, y: bar.y }, end];
        const at0 = T.bead0 + depth * T.beadStep;
        paths.push({ pts: withLengths(pts), t0: at0, t1: at0 + T.beadStep });
        arrive.set(c.key, at0 + T.beadStep);
        if (B.bars.has(`bar:${c.id}`)) walk(c, { x: c.x, y: c.eff ? c.eff.y + 4 : c.y1 }, depth + 1);
      }
    };
    walk(b, { x: b.x, y: startY }, 0);
    if (paths.length) out.push({ key, paths, arrive });
  }
  return out;
}
function withLengths(pts) {
  let L = 0;
  const out = pts.map((p, k) => { if (k) L += Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y); return { ...p, L }; });
  out.total = L;
  return out;
}
function pointAlong(pts, d) {
  if (d <= 0) return pts[0];
  for (let k = 1; k < pts.length; k += 1) if (pts[k].L >= d) { const a = pts[k - 1], b = pts[k], f = (d - a.L) / Math.max(1e-6, b.L - a.L); return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) }; }
  return pts.at(-1);
}
function heroArrival(i, t) {
  const h = treeOf(i).hero;
  if (!h.length || !t) return null;
  const at = Math.max(...h.map(n => t.arrive.get(n.key) ?? -1));
  return at >= 0 ? at : null;
}

// ---------- frame changes ----------
let keyRepeat = false;
addEventListener('keydown', event => { keyRepeat = event.repeat; }, true);
stage.onFrame((next, previous) => {
  if (!driving) {
    // Someone stepped: stop telling or playing, fold any card away at once, drop the told marks.
    stopRun(); freeze = false;
    ix.reset(); closePanel();
    clearMarks();
  }
  if (tr) finishTransition();
  if (view && !hasLayer(next, view)) { view = null; syncUI(); }
  const mode = driving ? driving.mode : next === previous + 1 ? (keyRepeat ? 'sweep' : 'short') : next > previous ? 'sweep' : 'back';
  startPost(previous, next, mode, driving?.extra || 0);
  dirty = true;
});
/** The page steps itself (telling, playing): one round posted at a speed. */
function drive(i, mode, extra = 0) {
  driving = { mode, extra };
  try {
    if (i === stage.index) { if (tr) finishTransition(); if (mode !== 'snap') startPost(i, i, mode, extra); }
    else stage.go(i);
  } finally { driving = null; }
  if (mode === 'snap' && tr) finishTransition();
}

// ---------- drilling into a layer and back ----------
function drill(id, { animate = true } = {}) {
  if (!id || !hasLayer(stage.index, id) || view === id) return;
  if (tr) finishTransition();
  ix.reset(); closePanel();
  const from = view;
  view = id;
  if (animate) startDrill(stage.index, from, id);
  syncUI(); dirty = true;
  stage.refreshSide();
}
function rise({ animate = true } = {}) {
  if (!view) return;
  if (tr) finishTransition();
  ix.reset(); closePanel();
  const from = view;
  view = null;
  if (animate) startDrill(stage.index, from, null);
  syncUI(); dirty = true;
  stage.refreshSide();
}

// ---------- telling and playing ----------
function setRunUI() {
  document.body.classList.toggle('st-playing', run.kind === 'play');
  const b = document.querySelector('[data-k="tell"]');
  if (b) { b.textContent = run.kind === 'tell' ? '跳过 ▸▸' : '▶ 讲一遍'; b.setAttribute('aria-pressed', String(run.kind === 'tell')); }
}
function stopRun() { if (!run.kind) return; run.kind = null; setRunUI(); }
function startTell() {
  if (!plan) return;
  freeze = false; stopRun(); ix.reset(); closePanel(); clearMarks();
  if (view) rise({ animate: false });
  drive(plan.from, 'snap');
  marks.on = true; marks.keys = new Set(treeOf(plan.end).hero.map(n => n.key));
  Object.assign(run, { kind: 'tell', k: -1, wait: 0.4 });
  setRunUI();
  if (reduced()) skipTell();
}
/** Skip to the end of the story: f26, the frame grown out of 发布, the deepest cords boxed. */
function skipTell() {
  if (!plan) return;
  stopRun(); freeze = false;
  if (view && view !== plan.drill) rise({ animate: false });
  drive(plan.end, 'snap');
  if (plan.drill && view !== plan.drill) drill(plan.drill, { animate: false });
  if (tr) finishTransition();
  marks.on = true; marks.shown = true; marks.sticky = true; marks.keys = new Set(treeOf(plan.end).hero.map(n => n.key));
  dirty = true;
}
function startPlay() {
  freeze = false; stopRun(); ix.reset(); closePanel(); clearMarks();
  if (stage.index >= LAST) drive(0, 'snap');
  Object.assign(run, { kind: 'play', k: 0, wait: 0 });
  setRunUI();
}
stage.play = startPlay;
stage.pause = () => { if (run.kind === 'play') stopRun(); };
stage.toggle = () => (run.kind === 'play' ? stage.pause() : startPlay());
const stepDur = step => (step.type === 'post' ? null : step.type === 'drill' ? 0.55 : step.dur);
function runStep(step) {
  if (step.type === 'post') drive(step.i, 'full', step.extra);
  else if (step.type === 'drill') drill(step.id);
  else run.wait = step.dur;
}
/** A still of the story at `s` seconds (for stills and checks): released by any control. */
function tellAt(s) {
  if (!plan) return;
  startTell();
  stopRun();
  let t = s - 0.4, through = true;
  for (const step of plan.steps) {
    if (t < 0) { through = false; break; }
    runStep(step);
    const len = step.type === 'post' ? tr.dur : stepDur(step);
    if (t < len) {
      if (tr) { tr.t = t; if (tr.kind === 'post' && tr.heroAt != null && t >= tr.heroAt) marks.shown = true; }
      through = false;
      break;
    }
    if (tr) finishTransition();
    if (step.type === 'post') markReveal(step.i);
    t -= len;
  }
  if (through) marks.shown = true;
  freeze = true; dirty = true;
}
const markReveal = i => { if (marks.on && treeOf(i).hero.some(n => marks.keys?.has(n.key))) marks.shown = true; };
function tick(dt) {
  if (hold.at != null || freeze) return;
  if (tr) {
    tr.t += dt; dirty = true;
    if (tr.kind === 'post' && marks.on && tr.heroAt != null && tr.t >= tr.heroAt) marks.shown = true;
    if (tr.t >= tr.dur) { if (tr.kind === 'post') markReveal(tr.i); tr = null; }
  }
  if (!run.kind || tr) return;
  if (run.wait > 0) { run.wait -= dt; return; }
  if (run.kind === 'tell') {
    run.k += 1;
    const step = plan.steps[run.k];
    if (!step) { stopRun(); marks.sticky = true; return; }
    runStep(step);
  } else {
    if (stage.index >= LAST) { stopRun(); return; }
    drive(stage.index + 1, 'half');
  }
}
addEventListener('keydown', event => {
  // Any key skips the story (Tab still moves focus); after it, the first key drops the told marks.
  if (run.kind === 'tell' && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key) && !event.metaKey && !event.ctrlKey) {
    skipTell();
    if (event.key !== 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); }
    return;
  }
  freeze = false;
  if (marks.sticky) clearMarks();
}, true);
addEventListener('pointerdown', () => { freeze = false; if (marks.sticky) clearMarks(); }, true);

// ---------- the told marks: the deepest cords' ≈ boxed once the bead has reached them ----------
const marks = { on: false, shown: false, sticky: false, keys: null };
function clearMarks() { Object.assign(marks, { on: false, shown: false, sticky: false, keys: null }); dirty = true; }

// ---------- resolving a moment: the scene(s) blended at the transition's clock ----------
const knotHalfH = (n, s) => { const u = n % 10; return u >= 2 ? ((4 + 3.2 * u) * s) / 2 : u === 1 ? 6 * s : 3.6 * s; };
/** Knot counts to draw: ink, or grey while untying the old number and tying the new one. */
function knotPhase(n0, n1, t, T, appear) {
  const d0 = digits(n0), d1 = digits(n1);
  if (!T || n0 === n1) return { t: d1.t, tT: d1.t, u: d1.u, uT: d1.u, grey: false };
  if (T.plain) return t < T.settle ? { t: d0.t, tT: d0.t, u: d0.u, uT: d0.u, grey: false } : { t: d1.t, tT: d1.t, u: d1.u, uT: d1.u, grey: false };
  if (t >= T.settle) return { t: d1.t, tT: d1.t, u: d1.u, uT: d1.u, grey: false };
  if (!appear && t < T.untie0) return { t: d0.t, tT: d0.t, u: d0.u, uT: d0.u, grey: false };
  if (!appear && t < T.untie0 + T.untieDur) {
    const p = (t - T.untie0) / Math.max(1e-6, T.untieDur);
    return { t: Math.ceil(d0.t * (1 - p)), tT: d0.t, u: Math.ceil(d0.u * (1 - p)), uT: d0.u, grey: true };
  }
  if (t < T.tie0) return { t: 0, tT: d1.t, u: 0, uT: d1.u, grey: true };
  // Tens drop in one by one, then the long knot is wound one turn at a time.
  const steps = d1.t + d1.u, p = (t - T.tie0) / Math.max(1e-6, T.settle - T.tie0 - 0.04), k = Math.min(steps, Math.floor(p * steps + 1e-6) + (steps ? 1 : 0));
  return { t: Math.min(d1.t, k), tT: d1.t, u: Math.max(0, k - d1.t), uT: d1.u, grey: true };
}
const NUM_FIELDS = ['x', 'y0', 'y1', 's', 'tensY', 'unitsY', 'w'];
function lerpText(a, b, k) { return a && b ? { ...b, x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), size: lerp(a.size, b.size, k) } : b || a; }
/** Everything drawn at this moment, with positions, alphas, knot counts and the texts in force. */
function resolve() {
  const S = sceneOf(stage.index, view);
  const R = { cords: [], bars: [], tops: [], texts: [], guides: [], left: [], main: S.main, frame: null, header: null, beads: [], ask: [] };
  if (!tr) {
    for (const key of S.order) R.cords.push(staticCord(S.nodes.get(key)));
    for (const b of S.bars.values()) R.bars.push({ ...b, alpha: 1 });
    for (const t of S.tops) R.tops.push({ ...t, alpha: 1 });
    R.guides = S.guides.map(g => ({ ...g, alpha: 1 })); R.left = S.left.map(l => ({ ...l, alpha: 1 }));
    if (S.frame) { R.frame = { ...S.frame, alpha: 1 }; R.header = { ...S.header, alpha: 1 }; }
    return R;
  }
  const { A, B, t } = tr;
  const isPost = tr.kind === 'post', T = tr.T;
  const mv = isPost ? easeOutBack((t - T.move0) / T.moveDur) : easeOut(t / tr.dur);
  const app = isPost ? easeOut((t - T.move0) / T.moveDur) : easeOut(t / tr.dur);
  const settled = !isPost || t >= T.settle;
  // A drill: what only the frame has fades in once the frame has nearly grown to it; what only the root view has goes first.
  const fadeIn = isPost ? (settled ? 1 : 0) : clamp((mv - 0.62) / 0.38), fadeOut = isPost ? 1 - app : clamp(1 - mv * 1.6);
  const keys = [...new Set([...A.order, ...B.order])];
  for (const key of keys) {
    const a = A.nodes.get(key), b = B.nodes.get(key);
    if (a && b) {
      const c = { ...b };
      for (const f of NUM_FIELDS) c[f] = lerp(a[f], b[f], f === 's' || f === 'w' ? (isPost ? app : mv) : mv);
      c.slot = { x0: lerp(a.slot.x0, b.slot.x0, mv), x1: lerp(a.slot.x1, b.slot.x1, mv) };
      c.bottom = lerp(a.bottom, b.bottom, mv);
      c.knots = isPost ? knotPhase(a.n, b.n, t, T, false) : knotPhase(b.n, b.n);
      c.alpha = 1;
      if (isPost) {
        c.num = settled ? b.num && { ...b.num, x: c.x + 8 * c.s + 1, y: c.tensY + 4 } : a.num && { ...a.num, x: c.x + 8 * c.s + 1, y: c.tensY + 4 };
        c.label = lerpText(settled ? a.label && { ...a.label, text: b.label?.text ?? a.label.text } : a.label, b.label, mv);
        if (!settled && a.label && b.label) c.label = { ...c.label, text: a.label.text };
        const arrived = !tr.arrive.has(key) ? settled : t >= tr.arrive.get(key);
        c.eff = arrived ? lerpText(a.eff, b.eff, mv) : a.eff && b.eff ? { ...lerpText(a.eff, b.eff, mv), text: a.eff.text } : (settled ? b.eff : a.eff);
        c.pill = settled ? lerpText(a.pill, b.pill, mv) : a.pill && { ...lerpText(a.pill, b.pill || a.pill, mv), text: a.pill.text };
        c.asks = settled ? b.asks : a.asks;
        c.label2 = null;
      } else {
        // A drill: texts that change (a name grows to the full title, the number joins the name) cross-fade.
        const cross = (p, q) => (p && q && p.text !== q.text ? [{ ...lerpText(p, q, mv), text: p.text, alpha: clamp(1 - mv * 2) }, { ...lerpText(p, q, mv), alpha: clamp(mv * 2 - 1) }] : [p && q ? { ...lerpText(p, q, mv), alpha: 1 } : p ? { ...p, alpha: fadeOut } : q ? { ...q, alpha: fadeIn } : null]);
        [c.label, c.label2] = cross(a.label, b.label);
        c.num = a.num && b.num ? { ...lerpText(a.num, b.num, mv), alpha: 1 } : a.num ? { ...a.num, x: c.x + 8 * c.s + 1, y: c.tensY + 4, alpha: fadeOut } : b.num ? { ...b.num, alpha: fadeIn } : null;
        c.eff = a.eff && b.eff ? lerpText(a.eff, b.eff, mv) : a.eff ? { ...a.eff, alpha: fadeOut } : b.eff ? { ...b.eff, alpha: fadeIn } : null;
        c.pill = a.pill && !b.pill ? { ...a.pill, alpha: fadeOut } : b.pill && !a.pill ? { ...b.pill, alpha: fadeIn } : b.pill;
        c.asks = b.asks;
        c.askAlpha = a.asks && !b.asks ? fadeOut : !a.asks && b.asks ? fadeIn : 1;
      }
      R.cords.push(c);
    } else if (b) {
      // Appearing: the cord grows down from its bar, ties its knots, and its texts land at the settle.
      const c = { ...b, alpha: app, knots: isPost ? knotPhase(0, b.n, t, T, true) : knotPhase(b.n, b.n) };
      c.y1 = lerp(b.y0, b.y1, app);
      for (const f of ['num', 'label', 'eff', 'pill']) c[f] = b[f] && { ...b[f], alpha: fadeIn };
      c.askAlpha = fadeIn;
      R.cords.push(c);
    } else {
      // Leaving: merged ones slide to where they went first; every leaving cord retracts into its bar and fades.
      const c = { ...a, alpha: fadeOut, knots: isPost ? knotPhase(a.n, 0, t, T, false) : knotPhase(a.n, a.n) };
      const into = isPost && a.id ? records[tr.i].snapshot.items[a.id]?.merged_into : null;
      const target = into && B.nodes.get(`p:${into}`);
      if (target) c.x = lerp(a.x, target.x, mv);
      c.y1 = lerp(a.y1, a.y0, app);
      if (a.rank > 0 && !isPost) { const bar = A.bars.get(`bar:${a.parent?.slice(2)}`); if (bar) c.y1 = lerp(a.y1, bar.y + 2, app); }
      for (const f of ['num', 'label', 'eff', 'pill']) c[f] = a[f] && { ...a[f], alpha: fadeOut };
      c.askAlpha = fadeOut;
      R.cords.push(c);
    }
  }
  const barKeys = new Set([...A.bars.keys(), ...B.bars.keys()]);
  for (const k of barKeys) {
    const a = A.bars.get(k), b = B.bars.get(k);
    if (a && b) R.bars.push({ ...b, x0: lerp(a.x0, b.x0, mv), x1: lerp(a.x1, b.x1, mv), y: lerp(a.y, b.y, mv), w: lerp(a.w, b.w, mv), alpha: 1 });
    else if (b) R.bars.push({ ...b, alpha: app, x0: lerp(b.x0 + (b.x1 - b.x0) / 2, b.x0, app), x1: lerp(b.x0 + (b.x1 - b.x0) / 2, b.x1, app) });
    else R.bars.push({ ...a, alpha: fadeOut });
  }
  const topKeys = new Set([...A.tops.map(x => x.key), ...B.tops.map(x => x.key)]);
  for (const k of topKeys) {
    const a = A.tops.find(x => x.key === k), b = B.tops.find(x => x.key === k);
    if (a && b) {
      const ties = b.ties.map((x, j) => lerp(a.ties[j] ?? x, x, mv));
      R.tops.push({ ...b, x0: lerp(a.x0, b.x0, mv), x1: lerp(a.x1, b.x1, mv), y: lerp(a.y, b.y, mv), ties, sum: settled ? b.sum : a.sum, alpha: 1 });
    } else if (b) R.tops.push({ ...b, alpha: isPost ? app : fadeIn });
    else R.tops.push({ ...a, alpha: fadeOut });
  }
  R.main = { ...B.main, y: lerp(A.main.y, B.main.y, mv) };
  if (isPost) {
    R.guides = B.guides.map(g => ({ ...g, alpha: 1 }));
    R.left = (settled ? B.left : A.left).map(l => ({ ...l, alpha: 1 }));
    if (B.frame) { R.frame = { ...B.frame, alpha: 1 }; R.header = { ...(settled ? B.header : A.header || B.header), alpha: 1 }; }
  } else {
    R.guides = [...A.guides.map(g => ({ ...g, alpha: fadeOut })), ...B.guides.map(g => ({ ...g, alpha: fadeIn }))];
    R.left = [...A.left.map(l => ({ ...l, alpha: fadeOut })), ...B.left.map(l => ({ ...l, alpha: fadeIn }))];
    // The frame grows out of the opened pendant's slot (or shrinks back into it).
    const big = B.frame || A.frame, opened = B.view || A.view, small = (B.frame ? A : B).nodes.get(`p:${opened}`);
    const from = small ? { x0: small.slot.x0 - 4, y0: small.y0 + 150, x1: small.slot.x1 + 4, y1: small.bottom + 8 } : big;
    const k = B.frame ? mv : 1 - mv;
    R.frame = { x0: lerp(from.x0, big.x0, k), y0: lerp(from.y0, big.y0, k), x1: lerp(from.x1, big.x1, k), y1: lerp(from.y1, big.y1, k), alpha: k };
    R.header = { ...(B.header || A.header), alpha: B.frame ? fadeIn : fadeOut };
  }
  // The beads of the conversion: a grey dot with a short trail along each path that is under way.
  if (isPost) for (const b of tr.beads) for (const p of b.paths) {
    if (t < p.t0 || t > p.t1 + T.trail) continue;
    const head = clamp((t - p.t0) / (p.t1 - p.t0)), tail = clamp((t - T.trail - p.t0) / (p.t1 - p.t0));
    R.beads.push({ pts: p.pts, head: easeInOut(head) * p.pts.total, tail: easeInOut(tail) * p.pts.total, done: head >= 1 });
  }
  return R;
}
function staticCord(n) {
  return { ...n, alpha: 1, knots: knotPhase(n.n, n.n), label2: null, askAlpha: 1 };
}

// ---------- painting ----------
let dirty = true, R = null;
const lit = { chain: null, key: '' };
/** The focused cord, its ancestors and descendants (a summary cord: its members and theirs). */
function chainOf(key, S) {
  const set = new Set([key]);
  if (!key) return set;
  if (key.startsWith('top:')) {
    const top = S.tops.find(t => t.key === key);
    for (const m of top?.members || []) set.add(m);
  }
  const tree = treeOf(S.i), n = tree.byKey.get(key);
  for (let x = n?.parent; x && x.level >= 0; x = x.parent) set.add(x.key);
  const down = k => { const node = tree.byKey.get(k); for (const c of node?.kids || []) { set.add(c.key); down(c.key); } };
  for (const k of [...set]) down(k);
  for (const k of [...set]) if (k.startsWith('p:')) set.add(`bar:${k.slice(2)}`);
  if (key.startsWith('blank:')) set.add(`bar:${key.slice(6)}`);
  return set;
}
function paint() {
  if (!ctx) return;
  R = resolve();
  const S = sceneOf(stage.index, view);
  const X = ix.X, focus = X.dim > 0.001 ? X.focus : null;
  if (lit.key !== `${focus}|${stage.index}|${view}`) { lit.key = `${focus}|${stage.index}|${view}`; lit.chain = focus ? chainOf(focus, S) : null; }
  const popFixed = X.popId ? clamp(X.pop) : 0;
  const dimTo = 1 - (0.3 + 0.52 * popFixed) * X.dim;
  const fa = k => (!lit.chain || lit.chain.has(k) ? 1 : dimTo);
  // Popping: the opened cord and everything under it move down along the cord (a summary cord moves up).
  const popSet = X.popId && X.pop > 0.001 ? chainOf(X.popId, S) : null;
  const popDy = popSet ? IX.pop * X.pop : 0;
  const isUnder = k => popSet && popSet.has(k) && !(X.popId.startsWith('p:') && treeOf(S.i).byKey.get(k)?.level < treeOf(S.i).byKey.get(X.popId)?.level);
  const concept = 1 - 0.6 * X.dim;
  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'butt';
  // Frame (the opened layer) behind everything.
  if (R.frame && R.frame.alpha > 0.01) {
    ctx.globalAlpha = R.frame.alpha;
    ctx.strokeStyle = C.ink3; ctx.lineWidth = 1;
    ctx.strokeRect(R.frame.x0 + 0.5, R.frame.y0 + 0.5, R.frame.x1 - R.frame.x0 - 1, R.frame.y1 - R.frame.y0 - 1);
  }
  // Band guides and the label column.
  for (const g of R.guides) { ctx.globalAlpha = g.alpha; ctx.fillStyle = C.faint; ctx.fillRect(g.x0, Math.round(g.y) - 0.5, g.x1 - g.x0, 1); }
  for (const l of R.left) text(l.text, l.x, l.y, l.size, l.weight || 400, l.color || C.ink, 'right', l.alpha, l.mono);
  if (R.header && R.header.alpha > 0.01) {
    text(R.header.title, R.header.x, R.header.y, 13, 600, C.ink, 'left', R.header.alpha);
    text(R.header.sub, R.header.x + widthOf(R.header.title, 13, 600) + 12, R.header.y, 11.5, 400, C.ink2, 'left', R.header.alpha);
  }
  // Summary cords: ties first, then the cord, its name and its sum.
  for (const top of R.tops) {
    const a = top.alpha * fa(top.key), dy = X.popId === top.key ? -popDy : 0;
    if (a < 0.01) continue;
    ctx.globalAlpha = a; ctx.strokeStyle = C.ink3; ctx.lineWidth = 0.8; ctx.setLineDash([2, 2]);
    ctx.beginPath(); for (const x of top.ties) { ctx.moveTo(x, top.y + dy); ctx.lineTo(x, R.main.y - 1); } ctx.stroke();
    ctx.setLineDash([]); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(top.x0, top.y + dy); ctx.lineTo(top.x1, top.y + dy); ctx.stroke();
    text(top.g, top.x0, top.y + dy - 7, 11.5, 500, C.ink2, 'left', a);
    text(String(top.sum), top.x1, top.y + dy - 7, 12, 600, C.ink, 'right', a, true);
  }
  // The main cord.
  ctx.globalAlpha = 1; ctx.strokeStyle = C.ink; ctx.lineWidth = R.main.w;
  ctx.beginPath(); ctx.moveTo(R.main.x0, R.main.y); ctx.lineTo(R.main.x1, R.main.y); ctx.stroke();
  // Short bars: each layer's own cord.
  for (const b of R.bars) {
    const a = b.alpha * fa(b.key), dy = isUnder(b.owner) || (popSet && popSet.has(b.key)) ? popDy : 0;
    if (a < 0.01) continue;
    ctx.globalAlpha = a; ctx.strokeStyle = C.ink; ctx.lineWidth = b.w;
    ctx.beginPath(); ctx.moveTo(b.x0, b.y + dy); ctx.lineTo(b.x1, b.y + dy); ctx.stroke();
  }
  // Pendants: the cord, its knots, its number, name and root equivalent.
  const hits = [];
  for (const c of R.cords) {
    const a = c.alpha * fa(c.key);
    const own = popSet && popSet.has(c.key), dy = own ? popDy : 0, dy0 = own && c.key !== X.popId ? popDy : 0;
    if (a < 0.01) continue;
    ctx.globalAlpha = a; ctx.strokeStyle = c.dashed ? C.ink3 : C.ink; ctx.lineWidth = c.dashed ? 1.3 : c.w; ctx.setLineDash(c.dashed ? [3, 2.5] : []);
    ctx.beginPath(); ctx.moveTo(c.x, c.y0 + dy0); ctx.lineTo(c.x, c.y1 + dy); ctx.stroke();
    ctx.setLineDash([]);
    if (c.s > 0.05) drawKnots(c.x, c.tensY + dy, c.unitsY + dy, c.s, c.knots, c.dashed, a, concept);
    if (c.asks && c.s > 0.05) {
      ctx.globalAlpha = a * (c.askAlpha ?? 1); ctx.fillStyle = C.red;
      const q = 6 * Math.max(0.75, c.s);
      for (let k = 0; k < c.asks; k += 1) ctx.fillRect(c.x - 5 - q, c.y0 + dy0 + 8 + k * (q + 3), q, q);
    }
    if (c.num) text(c.num.text, c.num.x, c.num.y + dy, c.num.size, 600, c.dashed ? C.ink2 : C.ink, 'left', a * (c.num.alpha ?? 1), true);
    for (const l of [c.label, c.label2]) {
      if (!l) continue;
      if (l.down) textDown(l.text, l.beside ? l.x + l.size / 2 : l.x, l.y + dy, l.size, l.weight, l.color || C.ink, a * (l.alpha ?? 1));
      else text(l.text, l.x, l.y + dy, l.size, l.weight, l.color || C.ink, 'center', a * (l.alpha ?? 1), l.mono, l.bg);
    }
    if (c.eff) {
      const boxed = marks.on && marks.shown && marks.keys?.has(c.key);
      text(c.eff.text, c.eff.x, c.eff.y + dy, c.eff.size, 500, C.ink2, 'center', a * (c.eff.alpha ?? 1), true, true, boxed);
    }
    if (c.pill) pill(c.pill.text, c.pill.x, c.pill.y + dy, a * (c.pill.alpha ?? 1));
    hits.push(hitShapes(c, dy, dy0));
  }
  // The concept layer's bead: grey, a short trail, only while a conversion runs.
  for (const b of R.beads) {
    const steps = 10, len = b.head - b.tail;
    ctx.globalAlpha = 1;
    for (let k = 0; k < steps; k += 1) {
      const p = pointAlong(b.pts, b.tail + (len * k) / steps), q = pointAlong(b.pts, b.tail + (len * (k + 1)) / steps);
      ctx.strokeStyle = GREY(0.5 * concept * ((k + 1) / steps)); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
    if (!b.done) { const h = pointAlong(b.pts, b.head); ctx.fillStyle = GREY(0.95 * concept); ctx.beginPath(); ctx.arc(h.x, h.y, 3.6, 0, Math.PI * 2); ctx.fill(); }
  }
  // Keyboard focus: a ring round the cord's knots.
  if (X.keyFocus) {
    const c = R.cords.find(x => x.key === X.keyFocus), top = R.tops.find(x => x.key === X.keyFocus);
    ctx.globalAlpha = 1; ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
    if (c) ctx.strokeRect(c.x - 12, c.y0 + 4, 24 + (c.num ? widthOf(c.num.text, c.num.size, 600, true) : 0), Math.max(24, (c.label?.y ?? c.y1) - c.y0));
    if (top) ctx.strokeRect(top.x0 - 4, top.y - 20, top.x1 - top.x0 + 8, 26);
  }
  ctx.globalAlpha = 1;
  R.hits = hits;
}
function drawKnots(x, tensY, unitsY, s, k, hollow, a, concept) {
  const grey = k.grey, fill = grey ? GREY(0.85 * concept) : hollow ? C.ink3 : C.ink;
  ctx.globalAlpha = grey ? 1 : a;
  // Tens: single knots, centred on the band, one below the other.
  const r = 3.6 * s, gap = 9 * s;
  for (let j = 0; j < k.t; j += 1) {
    const y = tensY + (j - (k.tT - 1) / 2) * gap;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (hollow && !grey) { ctx.strokeStyle = fill; ctx.lineWidth = 1.1; ctx.fillStyle = C.paper; ctx.fill(); ctx.stroke(); } else { ctx.fillStyle = fill; ctx.fill(); }
  }
  // Units: a long knot of n turns (a capsule cut by n − 1 thin lines), wound from the top; 1 is a figure-eight.
  if (!k.u) return;
  if (k.uT === 1) {
    ctx.strokeStyle = fill; ctx.lineWidth = 1.7 * s; ctx.fillStyle = C.paper;
    for (const dy of [-3 * s, 3 * s]) { ctx.beginPath(); ctx.arc(x, unitsY + dy, 2.9 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    return;
  }
  const full = (4 + 3.2 * k.uT) * s, top = unitsY - full / 2, h = (4 + 3.2 * k.u) * s, w = 8.4 * s;
  roundRect(x - w / 2, top, w, h, Math.min(4 * s, h / 2));
  if (hollow && !grey) { ctx.fillStyle = C.paper; ctx.fill(); ctx.strokeStyle = fill; ctx.lineWidth = 1.1; ctx.stroke(); } else { ctx.fillStyle = fill; ctx.fill(); }
  ctx.strokeStyle = hollow && !grey ? fill : C.paper; ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let j = 1; j < k.u; j += 1) { const y = top + (j * h) / k.u; ctx.moveTo(x - w / 2 + 0.8, y); ctx.lineTo(x + w / 2 - 0.8, y); }
  ctx.stroke();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}
function text(str, x, y, size, weight, color, align, alpha = 1, mono = false, bg = false, boxed = false) {
  if (!str || alpha < 0.01) return;
  ctx.globalAlpha = alpha;
  ctx.font = fontOf(size, weight, mono);
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  if (bg || boxed) {
    const w = ctx.measureText(str).width, x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.fillStyle = C.paper; ctx.fillRect(x0 - 3, y - size * 0.92, w + 6, size * 1.22);
    if (boxed) { ctx.strokeStyle = C.ink; ctx.lineWidth = 1.4; ctx.strokeRect(x0 - 3.5, y - size * 0.95, w + 7, size * 1.3); }
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}
/** A name hanging downwards from (cx, y): upright CJK characters, runs of Latin and digits turned on their side. */
function textDown(str, cx, y, size, weight, color, alpha) {
  if (!str || alpha < 0.01) return;
  ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.textBaseline = 'middle';
  let yy = y;
  for (const run of runsOf(str)) {
    if (/^\s+$/.test(run)) { yy += size * 0.4; continue; }
    if (isSide(run)) {
      ctx.save(); ctx.font = fontOf(size * 0.92, weight); ctx.textAlign = 'left';
      ctx.translate(cx, yy); ctx.rotate(Math.PI / 2); ctx.fillText(run, 0, 0.5);
      ctx.restore();
      yy += widthOf(run, size * 0.92) + 1;
    } else {
      ctx.font = fontOf(size, weight); ctx.textAlign = 'center';
      ctx.fillText(run, cx, yy + size / 2);
      yy += size + 1.5;
    }
  }
  ctx.textBaseline = 'alphabetic';
}
function pill(str, x, y, alpha) {
  if (alpha < 0.01) return;
  ctx.globalAlpha = alpha;
  ctx.font = fontOf(10, 500, true);
  const w = ctx.measureText(str).width + 10, h = 15;
  ctx.fillStyle = C.paper; roundRect(x - w / 2, y - h / 2, w, h, 7.5); ctx.fill();
  ctx.strokeStyle = C.ink3; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y + 0.5);
  ctx.textBaseline = 'alphabetic';
}

// ---------- hit testing: what is under a point, from what was last painted ----------
const HIT = 10;
/** The boxes a cord is drawn with: the cord itself, its knots, number, name, root equivalent, question marks and pill. */
function hitShapes(c, dy, dy0) {
  const boxes = [{ x0: c.x - 1.5, x1: c.x + 1.5, y0: c.y0 + dy0 + 3, y1: c.y1 + dy }];
  if (c.s > 0.05) {
    const kw = 4.5 * c.s, d = digits(c.n);
    if (d.t) boxes.push({ x0: c.x - kw, x1: c.x + kw, y0: c.tensY + dy - (d.t * 9 * c.s) / 2, y1: c.tensY + dy + (d.t * 9 * c.s) / 2 });
    if (d.u) boxes.push({ x0: c.x - kw, x1: c.x + kw, y0: c.unitsY + dy - knotHalfH(c.n, c.s), y1: c.unitsY + dy + knotHalfH(c.n, c.s) });
    if (c.asks) boxes.push({ x0: c.x - 11 - 6 * c.s, x1: c.x - 4, y0: c.y0 + dy0 + 6, y1: c.y0 + dy0 + 10 + c.asks * 9 });
  }
  const textBox = (l, align = 'center', mono = false, weight = 400) => {
    if (!l || (l.alpha ?? 1) < 0.5) return;
    const w = widthOf(l.text, l.size, l.weight ?? weight, l.mono ?? mono), x0 = align === 'center' ? l.x - w / 2 : l.x;
    boxes.push({ x0: x0 - 2, x1: x0 + w + 2, y0: l.y + dy - l.size, y1: l.y + dy + 3 });
  };
  textBox(c.num, 'left', true, 600); textBox(c.eff, 'center', true, 500);
  if (c.label?.down) {
    const l = c.label, cx = l.beside ? l.x + l.size / 2 : l.x;
    if ((l.alpha ?? 1) >= 0.5) boxes.push({ x0: cx - l.size / 2 - 2, x1: cx + l.size / 2 + 2, y0: l.y + dy - 2, y1: l.y + dy + downLength(l.text, l.size) });
  } else textBox(c.label);
  if (c.pill) { const w = widthOf(c.pill.text, 10, 500, true) + 10; boxes.push({ x0: c.pill.x - w / 2, x1: c.pill.x + w / 2, y0: c.pill.y + dy - 8, y1: c.pill.y + dy + 8, pill: true }); }
  return { key: c.key, boxes, alpha: c.alpha, pill: c.pill ? boxes.at(-1) : null, x: c.x, row: c.tensY + dy };
}
const edgeDistance = (x, y, b) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));
function hitAt(x, y) {
  if (!R?.hits) return null;
  for (const top of R.tops) if (top.alpha > 0.5 && y >= top.y - 20 && y <= top.y + HIT && x >= top.x0 - HIT && x <= top.x1 + HIT && hasKey(top.key)) return top.key;
  let best = null, bd = HIT;
  for (const h of R.hits) {
    if (h.alpha < 0.5 || !hasKey(h.key)) continue;
    const d = Math.min(...h.boxes.map(b => edgeDistance(x, y, b)));
    if (d < bd || (d === bd && best && Math.abs(x - h.x) < Math.abs(x - best.x))) { bd = d; best = h; }
  }
  return best ? best.key : null;
}
function pillAt(x, y) {
  for (const h of R?.hits || []) if (h.pill && x >= h.pill.x0 - 2 && x <= h.pill.x1 + 2 && y >= h.pill.y0 - 2 && y <= h.pill.y1 + 2) return h.key;
  return null;
}
/** Is the cord on screen and touchable now: in the scene, and not still appearing in a round being posted. */
function hasKey(key) {
  if (!key) return false;
  const S = sceneOf(stage.index, view);
  const exists = key.startsWith('top:') ? S.tops.some(t => t.key === key) : S.nodes.has(key);
  if (!exists) return false;
  if (tr && tr.kind === 'drill') return false;
  // While a round is being posted only what was already there (and stays) can be touched: a cord still growing in
  // has nothing settled to say yet, and one leaving is not in this round's tree.
  if (tr && tr.kind === 'post' && tr.t < tr.T.settle) return key.startsWith('top:') ? tr.A.tops.some(t => t.key === key) : tr.A.nodes.has(key);
  return true;
}
function keyFor(name) {
  if (name == null) return null;
  const S = sceneOf(stage.index, view), tree = treeOf(stage.index);
  if (S.nodes.has(name) || S.tops.some(t => t.key === name)) return name;
  if (S.nodes.has(`p:${name}`)) return `p:${name}`;
  if (name === '留白' || name === 'blank') return view ? `blank:${view}` : 'blank';
  if (S.tops.some(t => t.g === name)) return `top:${name}`;
  const n = [...tree.byKey.values()].find(x => S.nodes.has(x.key) && (shortOf(x.id) === name || nameOf(x) === name));
  return n ? n.key : null;
}
const hitOf = key => R?.hits?.find(h => h.key === key) || null;
function pointOf(key) {
  const top = R?.tops.find(t => t.key === key);
  if (top) return { x: (top.x0 + top.x1) / 2, y: top.y };
  const c = R?.cords.find(x => x.key === key);
  if (!c) return null;
  return { x: c.x, y: c.s > 0.05 ? c.tensY : (c.y0 + Math.min(c.y1, c.y0 + 18)) / 2 };
}
/** A point d px left of the cord's drawn geometry on its tens row (left of a summary cord's name, for those). */
function nearOf(key, d = 9) {
  const top = R?.tops.find(t => t.key === key);
  if (top) return { x: top.x0 - d, y: top.y };
  const h = hitOf(key), p = pointOf(key);
  if (!h || !p) return null;
  const row = h.boxes.filter(b => p.y >= b.y0 && p.y <= b.y1);
  return { x: Math.min(...row.map(b => b.x0)) - d, y: p.y };
}

// ---------- the interaction (motion/ix.mjs) ----------
let X = { focus: null, dim: 0, pop: 0, popId: null, line: 0, card: 0, detail: false, peek: 0, peekId: null, keyFocus: null };
const answerLink = () => withDataset(`../../index.html?variant=d&frame=${frames[stage.index].id}`);
/** Where cards hang: beside the cord's knots, on the side with more room, never over the cord's own subtree. */
function anchorOf(key) {
  const top = R?.tops.find(t => t.key === key);
  if (top) {
    const facing = (top.x0 + top.x1) / 2 < W * 0.55 ? 1 : -1;
    return { x: facing > 0 ? top.x1 + 4 : top.x0 - 4, y: top.y, facing, keep: { x0: top.x0, y0: top.y - 20, x1: top.x1, y1: R.main.y + 4 } };
  }
  const c = R?.cords.find(x => x.key === key);
  if (!c) return { x: W / 2, y: H / 2, facing: 1 };
  const facing = c.x < W * 0.55 ? 1 : -1, dy = ix?.s.open === key ? IX.pop : 0;
  const y = c.s > 0.05 ? (c.tensY + c.unitsY) / 2 + dy : c.y0 + 14;
  const x0 = Math.min(c.slot.x0, c.x - 14), x1 = Math.max(c.slot.x1, c.x + 30);
  return { x: facing > 0 ? x1 : x0, y, facing, keep: { x0, y0: c.y0 - 4, x1, y1: Math.max(c.bottom, c.y1) + 6 + dy } };
}
const ix = createIx({
  stage: figure, keysIn: figure,
  facts: key => factsOf(key), has: hasKey, hit: hitAt, named: name => keyFor(name),
  pointOf, index: () => stage.index * 4 + (view ? 2 : 0) + (postLive() ? 1 : 0),
  pause: () => { if (hold.at == null) hold.at = now(); }, resume: () => { hold.at = null; }, paused: () => hold.at != null,
  last: LAST, answerHref: () => answerLink(), anchor: anchorOf, hug: 'keep',
  seen: () => { const l = postLive(); return { inputs: true, share: !l, asks: !l }; },
  peekHTML: (f, o) => peekCard(f, o), detailHTML: (f, o) => detailCard(f, o),
  skip: '.k-ui', label: '结绳：Tab 逐根看概要，Enter 展开详情，Esc 收回',
});

// ---------- the cards: this round, this cord ----------
const askShort = a => a.short || a.prompt;
const dueOf = a => (a.due_at ? dueText(Date.parse(a.due_at)) : '');
const answerOf = new Map();
frames.forEach((frame, i) => { for (const event of frame.events) for (const link of event.feedback || []) if (link.ask && !answerOf.has(link.ask)) answerOf.set(link.ask, { i, event, link }); });
const howAnswered = a => { const x = answerOf.get(a.id); return x ? responseSentence(x.event, x.link) : '你答了'; };
function howLapsed(a, i) {
  const d = (frames[i].batch?.declarations || []).find(x => x.id === a.item);
  const status = records[i].snapshot.items[a.item]?.status;
  const what = d?.kind === 'done' ? '改为已办' : d?.relation === 'withdraw' || status === 'withdrawn' ? '撤下' : status === 'merged' ? '并入' : '改写';
  return `随改写失效：${clip(nameOfId(a.item, i), 10)}${what}`;
}
const nameOfId = (id, i) => { const n = nodeAt(i, `p:${id}`) || nodeAt(Math.max(0, i - 1), `p:${id}`); return n ? nameOf(n) : shortOf(id); };
const subtreeIds = n => { const out = new Set([n.id]); const walk = x => { for (const c of x.kids) { out.add(c.id); walk(c); } }; walk(n); return out; };
const factCache = new Map();
function factsOf(key) {
  const i = stage.index, ck = `${i}:${view}:${key}`;
  if (factCache.has(ck)) return factCache.get(ck);
  const tree = treeOf(i), prev = i ? treeOf(i - 1) : null;
  let f;
  if (key.startsWith('top:')) {
    const g = tree.groups.find(x => `top:${x.g}` === key), pg = prev?.groups.find(x => x.g === g?.g);
    f = { key, i, kind: 'top', short: `合计绳 · ${g.g}`, g: g.g, sum: g.sum, before: pg?.sum ?? 0, members: g.members.map(n => ({ short: shortOf(n.id), share: n.share })), trend: frames.map((_, k) => treeOf(k).groups.find(x => x.g === g.g)?.sum || 0) };
  } else if (key.startsWith('blank')) {
    const parentId = key.includes(':') ? key.slice(6) : null, owner = parentId ? tree.byKey.get(`p:${parentId}`) : null;
    const n = owner ? 64 - owner.used : tree.blank, before = parentId ? (prev?.byKey.get(`p:${parentId}`) ? 64 - prev.byKey.get(`p:${parentId}`).used : 0) : prev ? prev.blank : 64;
    f = { key, i, kind: 'blank', short: owner ? `${shortOf(parentId)}的子层留白` : '根层留白', n, before, owner: owner ? { short: shortOf(parentId), eff: owner.eff } : null,
      trend: frames.map((_, k) => (owner ? (nodeAt(k, owner.key) ? 64 - nodeAt(k, owner.key).used : 0) : treeOf(k).blank)) };
  } else {
    const n = tree.byKey.get(key), p = prev?.byKey.get(key) || null;
    const ids = subtreeIds(n);
    const asks = [...askLife[i].open.values()].filter(a => ids.has(a.item));
    const closed = [...askLife[i].answered.map(a => ({ a, how: howAnswered(a), word: '答掉' })), ...askLife[i].lapsed.map(a => ({ a, how: howLapsed(a, i), word: '失效' }))].filter(x => ids.has(x.a.item));
    const before = p?.share ?? 0;
    f = { key, i, kind: 'cord', id: n.id, level: n.level, short: nameOf(n), title: n.item.title, summary: n.item.summary || '', group: n.group,
      share: n.share, before, change: !p ? '新增' : before === n.share ? '不变' : before < n.share ? `变大 ${before} → ${n.share}` : `变小 ${before} → ${n.share}`,
      eff: n.eff, effBefore: p?.eff ?? 0, chain: chainText(n), path: pathOf(n).map(nameOf), used: n.used,
      kids: n.kids.map(c => ({ key: c.key, short: nameOf(c), share: c.share, eff: c.eff, kids: c.kids.map(g => ({ short: nameOf(g), share: g.share, eff: g.eff })) })),
      asks, closed, responses: foldSentences(responsesIn(i).filter(r => ids.has(r.link.target))),
      trend: seriesOf(key), effTrend: seriesOf(key, 'eff'), usedTrend: seriesOf(key, 'used'), drillable: n.level === 0 && n.kids.length > 0 && view !== n.id };
  }
  factCache.set(ck, f);
  return f;
}
const knotWords = n => { const d = digits(n); return [d.t ? `十位 ${d.t} 结` : '', d.u ? `个位 ${d.u === 1 ? '8 字结' : `${d.u} 圈`}` : ''].filter(Boolean).join(' · ') || '没有结'; };
const askRow = a => `<div class="ix-ask"><i></i><span>${esc(askShort(a))}</span>${dueOf(a) ? `<small>${esc(dueOf(a))}</small>` : ''}</div>`;
function peekCard(f, { seen }) {
  const unsettled = !seen.share;
  if (f.kind === 'top') {
    return `<div class="ix-k">第 ${f.i} / ${LAST} 轮 · 合计绳</div><div class="ix-q">${esc(f.g)} ${unsettled ? f.before : f.sum} 份</div>
      <div class="ix-d">${unsettled ? '本轮还没落定' : f.before === f.sum ? '这一轮不变' : `这一轮 ${f.before} → ${f.sum}`}</div>
      <div class="ix-d k-pk-line">${esc(f.members.map(m => `${m.short} ${m.share}`).join(' + '))}</div>`;
  }
  if (f.kind === 'blank') {
    return `<div class="ix-k">第 ${f.i} / ${LAST} 轮 · 留白</div><div class="ix-q">${esc(f.short)} ${unsettled ? f.before : f.n} / 64</div>
      <div class="ix-d">${unsettled ? '本轮还没落定' : f.before === f.n ? '这一轮不变' : `这一轮 ${f.before} → ${f.n}`}</div>
      ${f.owner ? `<div class="ix-d">折合根层 ${effText((f.owner.eff * f.n) / 64)} 份</div>` : ''}`;
  }
  const where = f.level === 0 ? `${f.group}组` : f.path.slice(0, -1).join(' › ');
  const share = unsettled ? f.before : f.share;
  return `<div class="ix-k">第 ${f.i} / ${LAST} 轮 · ${esc(where)}</div><div class="ix-q">${esc(f.short)} ${share}${f.level ? ' / 64' : ' 份'}</div>
    ${f.level ? `<div class="ix-d">折合根层 ${unsettled ? effText(f.effBefore) : effText(f.eff)} 份 = ${esc(f.chain)}</div>` : ''}
    <div class="ix-d">${unsettled ? '本轮还没落定' : `这一轮${esc(f.change)}`}</div>
    ${f.kids.length && !unsettled ? `<div class="ix-d">子层用了 ${f.used} / 64 · 留白 ${64 - f.used}</div>` : ''}
    ${unsettled ? '' : f.asks.map(askRow).join('')}`;
}
function trendSVG(series, at, Hh = 30, top = null) {
  const n = LAST, Ww = 300, max = top ?? Math.max(24, ...series), bw = Ww / n;
  const bars = series.slice(1).map((s, k) => {
    const h = s ? Math.max(1.5, (s / max) * (Hh - 2)) : 1, i = k + 1;
    return `<rect x="${(k * bw + bw * 0.15).toFixed(1)}" y="${(Hh - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" class="${i === at ? 'is-now' : i > stage.index ? 'is-later' : s ? '' : 'is-off'}"/>`;
  }).join('');
  return `<svg class="ix-trend" viewBox="0 0 ${Ww} ${Hh}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg><div class="ix-axis"><span>${esc(frames[1].id)}</span><span>${esc(frames[LAST].id)}</span></div>`;
}
function detailCard(f, { seen, href }) {
  const unsettled = !seen.share;
  const close = '<button type="button" data-x="close" aria-label="收回（Esc）" title="收回（Esc）">×</button>';
  if (f.kind === 'top') {
    return `<div class="ix-d-k"><span>第 ${f.i} / ${LAST} 轮 · 合计绳</span>${close}</div><div class="ix-d-t">${esc(f.g)} ${unsettled ? f.before : f.sum} 份</div>
      <div class="ix-d-s">${unsettled ? '本轮还没落定' : f.before === f.sum ? '这一轮不变' : `这一轮 ${f.before} → ${f.sum}`}</div>
      <section><h5>绑着的垂绳<b>${f.members.length} 根</b></h5><ul class="ix-d-kids">${f.members.map(m => `<li><span>${esc(m.short)}</span><b>${m.share}</b></li>`).join('')}</ul></section>
      <section><h5>合计 · 逐轮<b>第 ${f.i} 轮 ${f.sum}</b></h5>${trendSVG(f.trend, f.i, 30, 64)}</section>
      <p class="ix-none">组按每件事两周的来源定：工作与社区并为工作，家庭与生活并为家里与生活。</p>`;
  }
  if (f.kind === 'blank') {
    return `<div class="ix-d-k"><span>第 ${f.i} / ${LAST} 轮 · 留白</span>${close}</div><div class="ix-d-t">${esc(f.short)} ${unsettled ? f.before : f.n} / 64</div>
      <div class="ix-d-s">${unsettled ? '本轮还没落定' : f.before === f.n ? '这一轮不变' : `这一轮 ${f.before} → ${f.n}`}${f.owner ? ` · 折合根层 ${effText((f.owner.eff * f.n) / 64)} 份` : ''}</div>
      <section><h5>留白 · 逐轮<b>第 ${f.i} 轮 ${f.n}</b></h5>${trendSVG(f.trend, f.i, 30, 64)}</section>`;
  }
  const share = unsettled ? f.before : f.share;
  const asks = f.asks.length ? f.asks.slice(0, 3).map(a => `<div class="ix-d-ask"><i></i><p>${esc(a.prompt)}</p><small>${esc([a.item !== f.id ? nameOfId(a.item, f.i) : '', dueOf(a) || '没有期限'].filter(Boolean).join(' · '))}</small><a href="${esc(href)}">去回答 →</a></div>`).join('') : '<p class="ix-none">没有开着的问题</p>';
  const closed = f.closed.length ? `<section><h5>这一轮关上的问题</h5><ul class="ix-d-fb">${f.closed.map(x => `<li>${x.word}「${esc(askShort(x.a))}」<time>${esc(x.how)}</time></li>`).join('')}</ul></section>` : '';
  const kids = f.kids.length ? `<section><h5>子层 · 它自己的 64 份<b>用了 ${f.used} · 留白 ${64 - f.used}</b></h5><ul class="ix-d-kids k-kids">${f.kids.map(c => `<li><span>${esc(c.short)}</span><b>${c.share}/64 · ≈${effText(c.eff)}</b></li>${c.kids.map(g => `<li class="k-gk"><span>${esc(g.short)}</span><b>${g.share}/64 · ≈${effText(g.eff)}</b></li>`).join('')}`).join('')}</ul>
      ${f.drillable ? `<button type="button" class="k-drill-btn" data-k="drill" data-id="${esc(f.id)}">长成子层画框 ↘</button>` : ''}</section>` : '';
  const responses = f.responses.length ? `<section><h5>这一轮你的回应</h5><ul class="ix-d-fb">${f.responses.map(x => `<li><time>${esc(dayTime(x.first.event.at).split(' ').pop())}</time>${esc(x.label)}</li>`).join('')}</ul></section>` : '';
  return `<div class="ix-d-k"><span>第 ${f.i} / ${LAST} 轮 · ${esc(f.level ? f.path.slice(0, -1).join(' › ') : `${f.group}组`)}</span>${close}</div>
    <div class="ix-d-t">${esc(f.title)}</div>
    <div class="ix-d-s"><b>${esc(f.short)} ${share}</b>${f.level ? ' / 64（在上一层的 64 份里）' : ' / 64 份'}${unsettled ? ' · 本轮还没落定' : ` · ${esc(f.change)}`}</div>
    <div class="ix-d-s">${esc(knotWords(share))}</div>
    ${f.level ? `<section><h5>折合根层<b>≈${unsettled ? effText(f.effBefore) : effText(f.eff)} 份</b></h5><p class="k-chain">${esc(f.chain)} = ${effText(f.eff)}</p></section>` : ''}
    ${kids}
    <section><h5>开着的问题<b>此刻 ${esc(frames[stage.index].id)}</b></h5>${unsettled ? '<p class="ix-none">本轮还没落定</p>' : asks}</section>
    ${unsettled ? '' : closed}${responses}
    <section><h5>份额 · 逐轮<b>${f.level ? '在上一层的 64 份里' : '根层'}</b></h5>${trendSVG(f.trend, f.i, 28, f.level ? 64 : null)}</section>
    ${f.summary ? `<p class="ix-d-sum">${esc(f.summary)}</p>` : ''}`;
}

// ---------- side panel: this round, the hero number on top; “这一件” when a cord is open ----------
let panelKey = null;
function asksList(i) {
  const open = [...askLife[i].open.values()], fresh = new Set(askLife[i].fresh.map(a => a.id));
  const li = a => `<li class="is-open"><b>${fresh.has(a.id) ? '新登记' : '开着'}</b><span>${esc(askShort(a))}</span><small>${esc([nameOfId(a.item, i), dueOf(a)].filter(Boolean).join(' · '))}</small><a href="${esc(answerLink())}">去回答 →</a></li>`;
  const after = [
    ...askLife[i].answered.map(a => `<li class="is-answered"><b>答掉</b><s>${esc(askShort(a))}</s><small>${esc(howAnswered(a))}</small></li>`),
    ...askLife[i].lapsed.map(a => `<li class="is-lapsed"><b>失效</b><span>${esc(askShort(a))}</span><small>${esc(howLapsed(a, i))}</small></li>`),
    ...open.map(li),
  ].join('');
  const before = i ? [...askLife[i - 1].open.values()].map(a => `<li><b>开着</b><span>${esc(askShort(a))}</span></li>`).join('') : '';
  const shut = askLife[i].answered.length + askLife[i].lapsed.length;
  const head = shut ? `这一轮的问题 <small>关上 ${shut} · 开着 ${open.length} · 去回答链到同一帧的 D</small>` : `开着的问题 <small>${open.length} 条 · 去回答链到同一帧的 D</small>`;
  return `<section class="k-asks"><h4><span class="k-post">${head}</span><span class="k-pre">开着的问题 <small>本轮还没落定</small></span></h4>
    <ul class="k-post">${after || '<li class="st-muted">没有开着的问题</li>'}</ul><ul class="k-pre">${before || '<li class="st-muted">没有开着的问题</li>'}</ul></section>`;
}
function heroHTML(i) {
  const tree = treeOf(i), prev = i ? treeOf(i - 1) : tree;
  const h = tree.hero, p = prev.hero;
  if (!h.length) {
    if (!anyLayers) return `<div class="k-none"><b>这两周没有子层</b><p>composite 两周 ${frames.length} 帧里，Agent 的批次没有给任何一件事分出子项：每根垂绳到名字就结束，这里只画根层与分组合计。子层、副绳与折合根层的画法见<a href="${esc(dataHref)}">手写情境</a>。</p></div>`;
    return '<div class="k-none"><b>这一轮没有子层</b><p>每根垂绳到名字就结束。</p></div>';
  }
  const names = h.map(nameOf);
  const line = (list, cls) => (list.length ? `<p class="k-hero-chain ${cls}">${esc(chainText(list[0], 6))}</p>` : `<p class="k-hero-chain ${cls}">这一层上一轮还没有</p>`);
  // The point of the form: when the deepest cord did not move but the number did, say which layer above moved.
  const was = i ? treeOf(i - 1).byKey.get(h[0].key) : null;
  let moved = '';
  if (was && was.share === h[0].share && Math.abs(was.eff - h[0].eff) > 1e-9) {
    const above = pathOf(h[0]).slice(0, -1).map(n => [n, treeOf(i - 1).byKey.get(n.key)]).filter(([n, o]) => o && o.share !== n.share);
    moved = `这一轮它自己一结没动，是上面变了：${above.map(([n, o]) => `${nameOf(n)} ${o.share} → ${n.share}`).join('，')}。`;
  }
  return `<div class="k-hero"><small>最深一层的一份 · 折合根层</small>
    <div class="k-hero-n"><b class="k-hero-pre">${p.length ? effText(p[0].eff) : '—'}</b><b class="k-hero-post">${effText(h[0].eff)}</b><span>份</span></div>
    ${line(p, 'k-hero-pre')}${line(h, 'k-hero-post')}
    ${moved ? `<p class="k-hero-moved k-hero-post">${esc(moved)}</p>` : ''}
    <p class="k-hero-note">${h.length > 1 ? `同深的 ${h.length} 件一样小：${esc(names.join('、'))}。` : `${esc(names[0])}。`}子层里的份数，要乘着上面每一层才折合成根层。</p></div>`;
}
function overview(i) {
  const tree = treeOf(i);
  if (i === 0 || !tree.root.kids.length) return { kicker: `这一轮 · ${frames[i].id}`, title: esc(frames[i].title), body: '<p>还没有整理过任何输入：主绳上还没有垂绳，64 份全是留白。按 → 或空格开始。</p>' };
  const prev = i ? treeOf(i - 1) : tree;
  const sums = (t, cls) => `<p class="k-sum ${cls}">根层 64 = ${t.groups.map(g => `${esc(g.g)} <b>${g.sum}</b>`).join(' + ')} + 留白 <b>${t.blank}</b></p>`;
  const layers = tree.layered.length ? `<section class="k-layers"><h4>子层 <small>${tree.layered.length} 件有自己的 64 份</small></h4><ul>${tree.layered.map(n => `<li class="${view === n.id ? 'is-on' : ''}"><button type="button" data-drill="${esc(n.id)}" title="长成子层画框">${esc(shortOf(n.id))} <b>${n.share}</b></button><span>用了 ${n.used}/64 · 留白 ${64 - n.used}</span><small>折合根层 ${effText((n.share * n.used) / 64)} 份</small></li>`).join('')}</ul></section>` : '';
  const inside = view && tree.byKey.get(`p:${view}`) ? (() => { const n = tree.byKey.get(`p:${view}`); return `<p class="k-inside">你在<b>${esc(shortOf(n.id))}</b>的子层里：它在根层占 ${n.share} 份，自己的 64 份用了 ${n.used}、留白 ${64 - n.used}，这一层的一份折合根层 ${effText(n.eff / 64)} 份。<button type="button" data-k="rise">← 根层</button></p>`; })() : '';
  return {
    kicker: `这一轮 · ${frames[i].id} · ${records[i].state.revision}`,
    title: esc(frames[i].title),
    body: `<div class="k-ov" data-i="${i}" data-phase="${postLive() && tr.i === i ? 'pre' : 'post'}" data-hero="${tr && tr.kind === 'post' && tr.i === i && tr.heroAt != null && tr.t < tr.heroAt ? 'pre' : 'post'}">
      ${inside}${heroHTML(i)}${sums(prev, 'k-pre')}${sums(tree, 'k-post')}${layers}${asksList(i)}
      <section><h4>读法</h4><p class="st-muted">每根绳上读结：靠横绳的一带单结是十位，一结十份；下一带长结的圈数是个位，1 用 8 字结。子层的结记的是它在上一层 64 份里的份数，≈ 后是折合根层的份数。</p></section>
      ${frames[i].narrative ? `<section><h4>旁白 <small>演示数据</small></h4><p>${esc(frames[i].narrative)}</p></section>` : ''}</div>`,
  };
}
stage.setOverview(overview);
const sideEls = { ov: null };
function paintSide() {
  const ov = document.querySelector('.k-ov');
  if (!ov) return;
  const i = Number(ov.dataset.i), mine = tr && tr.kind === 'post' && tr.i === i;
  const phase = mine && tr.t < tr.T.settle ? 'pre' : 'post';
  const hero = mine && tr.heroAt != null && tr.t < tr.heroAt ? 'pre' : 'post';
  if (ov.dataset.phase !== phase) ov.dataset.phase = phase;
  if (ov.dataset.hero !== hero) ov.dataset.hero = hero;
}
function panelFor(f) {
  return i => {
    const kick = `这一件 · ${frames[f.i].id}`;
    if (f.kind === 'top') return { kicker: kick, title: `合计绳 · ${esc(f.g)}`, body: `<section><h4>合计 · 逐轮 <small>此刻 ${f.sum} / 64</small></h4>${trendSVG(f.trend, f.i, 32, 64)}</section><section><h4>绑着的垂绳</h4><ul class="k-list">${f.members.map(m => `<li><span>${esc(m.short)}</span><b>${m.share}</b></li>`).join('')}</ul></section><p class="st-muted">组按每件事两周的来源定，整份回放只算一次，所以一件事不会中途换组。</p>` };
    if (f.kind === 'blank') return { kicker: kick, title: esc(f.short), body: `<section><h4>留白 · 逐轮 <small>此刻 ${f.n} / 64</small></h4>${trendSVG(f.trend, f.i, 32, 64)}</section>` };
    const n = nodeAt(i, f.key) || nodeAt(f.i, f.key);
    const closes = [];
    frames.forEach((_, k) => { for (const a of askLife[k].answered) if (a.item === f.id) closes.push({ k, a, how: '答' }); for (const a of askLife[k].lapsed) if (a.item === f.id) closes.push({ k, a, how: '失效' }); });
    const effRow = f.level ? `<section><h4>折合根层 · 逐轮 <small>此刻 ≈${effText(f.eff)}</small></h4>${trendSVG(f.effTrend, f.i, 32)}<p class="st-muted">${esc(f.chain)}。上面一层一变，这一行跟着变，哪怕这根绳自己没被改写。</p></section>` : '';
    const usedRow = f.kids.length || f.usedTrend.some(Boolean) ? `<section><h4>子层用了几份 · 逐轮 <small>此刻 ${f.used} / 64</small></h4>${trendSVG(f.usedTrend, f.i, 28, 64)}</section>` : '';
    return {
      kicker: kick, title: esc(n ? n.item.title : f.title),
      body: `<section><h4>份额 · 逐轮 <small>${f.level ? '在上一层的 64 份里' : '根层'} · 此刻 ${f.share}</small></h4>${trendSVG(f.trend, f.i, 32, f.level ? 64 : null)}</section>
        ${effRow}${usedRow}
        ${closes.length ? `<section><h4>问题关上的那几轮</h4><ul class="k-closes">${closes.map(x => `<li class="${x.k > i ? 'is-later' : ''}"><button type="button" data-st="go" data-frame="${x.k}"><time>${esc(frames[x.k].id)}</time></button><span>${x.how}「${esc(askShort(x.a))}」</span></li>`).join('')}</ul></section>` : ''}
        <details class="k-more"><summary>摘要、依据、来源与版本</summary>${itemDetailHTML(f.id, i)}</details>`,
    };
  };
}
function openPanel(f) {
  panelKey = f.key;
  stage.showDetail(panelFor(f));
  document.querySelector('.st-title').textContent = `这一件 · ${frames[f.i].id} · ${dayTime(frames[f.i].at)} / ${f.kind === 'cord' ? f.short : f.short}`;
}
function closePanel() {
  if (!panelKey) return;
  panelKey = null;
  stage.showDetail(null);
  document.querySelector('.st-title').textContent = frames[stage.index].title;
}
function paintPanel() {
  if (X.detail && ix.view && panelKey !== ix.view.key) openPanel(ix.view);
  else if (!X.detail && panelKey) closePanel();
}
stage.onEscape = () => { if (ix.s.open) { ix.close(); return true; } if (view) { rise(); return true; } return false; };

// ---------- the page's own controls: the pill, the drill button, ← 根层, the side panel's layer list ----------
// Capture phase, so a click on a pendant's pill drills instead of reaching ix (which would open the cord's card).
figure.addEventListener('click', event => {
  const b = event.target.closest?.('[data-k]');
  if (b?.dataset.k === 'drill') { event.stopPropagation(); drill(b.dataset.id); return; }
  if (b?.dataset.k === 'rise') { event.stopPropagation(); rise(); return; }
  if (event.target.closest?.('.ix-detail, .ix-peek, .ix-sr, a, button')) return;
  const box = figure.getBoundingClientRect(), key = pillAt(event.clientX - box.left, event.clientY - box.top);
  if (!key) return;
  // Touch: the first tap is the hover (ix), the second drills.
  if (ix.s.pointer === 'touch' && ix.s.hover !== key && !ix.s.open) return;
  event.stopPropagation();
  drill(key.slice(2));
}, true);
document.querySelector('.st-side').addEventListener('click', event => {
  const d = event.target.closest('[data-drill]'), r = event.target.closest('[data-k="rise"]');
  if (d) drill(d.dataset.drill);
  else if (r) rise();
});
document.querySelector('.st-tools').addEventListener('click', event => {
  const b = event.target.closest('[data-k="tell"]');
  if (b) { if (run.kind === 'tell') skipTell(); else startTell(); }
});
// Keyboard proxies: the cords from left to right, each followed by the cords under it; then the blank and the sums.
function proxyList() {
  const S = sceneOf(stage.index, view);
  const label = key => {
    const n = S.nodes.get(key), node = treeOf(stage.index).byKey.get(key);
    if (n.kind === 'blank') return `留白 ${n.n} 份`;
    return node.level ? `${pathOf(node).map(nameOf).join(' › ')} · ${node.share}/64 · 折合根层 ${effText(node.eff)}` : `${nameOf(node)} ${node.share} 份${node.kids.length ? ` · 子层用了 ${node.used}` : ''}`;
  };
  return [...S.order.filter(k => hasKey(k)).map(k => ({ id: k, label: label(k) })), ...S.tops.filter(t => hasKey(t.key)).map(t => ({ id: t.key, label: `合计绳 ${t.g} ${t.sum} 份` }))];
}
const proxyKey = () => `${stage.index}|${view}|${tr && tr.kind === 'drill' ? 'd' : postLive() ? 'p' : ''}`;

// ---------- the DOM around the canvas ----------
const ui = {};
function syncUI() {
  if (!ui.back) return;
  ui.back.hidden = !view || Boolean(tr && tr.kind === 'drill' && tr.rising);
  if (ui.note) ui.note.hidden = anyLayers || view != null;
}
function render() {
  const rect = figure.getBoundingClientRect();
  W = Math.round(rect.width); H = Math.round(rect.height);
  sceneCache.clear(); factCache.clear();
  const kept = [...figure.querySelectorAll(':scope > .ix-leaders, :scope > .ix-peek, :scope > .ix-detail, :scope > .ix-sr')];
  figure.innerHTML = `<canvas class="k-canvas" aria-hidden="true"></canvas>
    <div class="k-ui k-back" hidden style="left:${12}px;top:${G.frameTop + 10}px"><button type="button" data-k="rise" title="回到根层（Esc）">← 根层</button></div>
    ${anyLayers ? '' : `<div class="k-ui k-note" style="left:${G.LX}px;top:${noteTop()}px"><b>这两周没有子层</b><p>composite 两周 ${frames.length} 帧里，Agent 的批次没有给任何一件事分出子项，每根垂绳到名字就结束：这里只画根层与分组合计。子层、副绳与“≈ 折合根层”的画法见<a href="${esc(dataHref)}">手写情境 →</a></p></div>`}`;
  figure.append(...kept);
  const sr = kept.find(el => el.classList.contains('ix-sr'));
  if (sr) figure.prepend(sr);
  const canvas = figure.querySelector('.k-canvas');
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ui.back = figure.querySelector('.k-back');
  ui.note = figure.querySelector('.k-note');
  syncUI();
  // A resize keeps a transition where it is: its scenes are rebuilt for the new size.
  if (tr) { const keep = tr.t; if (tr.kind === 'post') { const prev = tr.A.i; startPost(prev, tr.i, tr.mode, tr.extra); } else startDrill(tr.i, tr.A.view, tr.B.view); tr.t = keep; }
  lit.key = '';
  ix?.relayout();
  dirty = true;
}

// ---------- the loop ----------
const perf = { on: params.has('perf'), times: [], work: [] };
let lastT = null, wasLive = false;
function loop(ms) {
  const w = ms / 1000, dt = lastT == null ? 0 : Math.min(0.1, w - lastT);
  if (perf.on && lastT != null) perf.times.push(w - lastT);
  lastT = w;
  const t0 = performance.now();
  tick(dt);
  X = ix.frame();
  if (marks.sticky && X.focus) clearMarks();
  const moving = live() || ix.live();
  if (dirty || moving || wasLive) { paint(); dirty = false; }
  wasLive = moving;
  paintSide();
  paintPanel();
  if (ui.back) { const hide = !view || Boolean(tr && tr.kind === 'drill' && tr.t < tr.dur * 0.8); if (ui.back.hidden !== hide) ui.back.hidden = hide; }
  ix.paint();
  ix.sync(proxyKey(), proxyList);
  if (perf.on) perf.work.push(performance.now() - t0);
  requestAnimationFrame(loop);
}
let resizeTimer = null;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });
render();
paint();
if (autoTell) startTell();
requestAnimationFrame(loop);

const p95 = list => [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.95)] || 0;
// Hooks with the same names and meanings as foldYield and foldDial (ix.mjs), plus the story and the frame.
window.foldKhipu = {
  ...ix.hooks(),
  hover: name => ix.hover(keyFor(name), 'pointer'),
  open: name => ix.open(keyFor(name)),
  pointOf: name => { const p = pointOf(keyFor(name)); if (!p) return null; const b = figure.getBoundingClientRect(); return { x: b.left + p.x, y: b.top + p.y }; },
  /** A point `d` px left of a cord's drawn geometry on its tens row (the widened hit band). */
  nearOf: (name, d = 9) => { const p = nearOf(keyFor(name), d); if (!p) return null; const b = figure.getBoundingClientRect(); return { x: b.left + p.x, y: b.top + p.y }; },
  /** The largest root pendant on screen. */
  pick: () => { const tree = treeOf(stage.index); const n = [...tree.root.kids].sort(bySize).find(x => hasKey(x.key)); return n ? shortOf(n.id) : '留白'; },
  tell: startTell, skip: skipTell, tellAt, play: startPlay, stop: stopRun,
  telling: () => run.kind === 'tell', playing: () => run.kind === 'play',
  settled: () => !tr || (tr.kind === 'post' ? tr.t >= tr.T.settle : tr.t >= tr.dur), phase:() => (tr ? { kind: tr.kind, i: tr.i, mode: tr.mode, t: +tr.t.toFixed(3), dur: +tr.dur.toFixed(3) } : null),
  drill: name => drill(String(keyFor(name) || name).replace(/^p:/, '')), rise, view: () => view,
  tree: i => { const t = treeOf(i ?? stage.index); return { hero: t.hero.map(n => ({ id: n.id, eff: n.eff, chain: chainText(n) })), groups: t.groups.map(g => ({ g: g.g, sum: g.sum })), blank: t.blank, layered: t.layered.map(n => ({ id: n.id, share: n.share, used: n.used })) }; },
  plan, groupOf,
  perf: () => {
    const ts = perf.times.slice(1), avg = ts.reduce((a, b) => a + b, 0) / Math.max(1, ts.length), work = perf.work.slice(1);
    return { frames: ts.length, fps: +(1 / avg).toFixed(1), p95ms: +(p95(ts) * 1000).toFixed(1), workMs: +(work.reduce((a, b) => a + b, 0) / Math.max(1, work.length)).toFixed(2), workP95ms: +p95(work).toFixed(2) };
  },
  resetPerf: () => { perf.on = true; perf.times = []; perf.work = []; },
};
