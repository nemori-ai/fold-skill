// docs/why.md（为什么要做 Fold）的配图，写进 docs/assets/why/（webp）：
// - d-*.webp 是示意图：按入口页“印着刻度的纸”的语言（纸白、墨黑、灰；朱红只给等他回应的），数据由演示回放现算
//   （只读原型的 variants/shared.mjs 与 variants/inflow.mjs，数据集 composite），画成 SVG 后用本机 Chrome 截成 2 倍图；
// - 其余是原型截图：从在跑的原型服务（make prototype，默认 http://127.0.0.1:4173）按固定视口与裁切重拍，停在 f22（8 月 14 日零点），
//   推后那张在 f22 推后一件再前进一轮。开头那张 phone-f22 沿用上一版，不在这里重拍。
// 最后用 cwebp 转成 webp。图的宽高写在 docs/why.md 的 <img width height> 里，换图后核对；node scripts/check-why.mjs 会查数量与死文件。
// 示意图里的文字（例子、标签）是照这份数据写的，演示数据改了要对着正文一起核对。
//
//   node scripts/why-figures.mjs                    # 全部重做（需要原型服务、本机 Chrome 与 cwebp）
//   node scripts/why-figures.mjs --drawings         # 只画示意图，不需要原型服务
//   node scripts/why-figures.mjs --only d-front-page,desk-f22
//   node scripts/why-figures.mjs --base http://127.0.0.1:4183 --out .local/why   # 换原型地址；写到别处先比对
//
// 只用 Node 22 内置的 WebSocket 驱动 Chrome（CHROME 可指定路径），不装依赖。
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const out = path.resolve(root, option('--out') || 'docs/assets/why');
const only = option('--only')?.split(',');
const base = (option('--base') || 'http://127.0.0.1:4173').replace(/\/$/, '');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------- the numbers, from the prototype's replay ----------
const load = rel => { const [file, query] = rel.split('?'); return import(pathToFileURL(path.join(root, 'prototype', file)).href + (query ? `?${query}` : '')); };
const { scenario, records, currentAsk } = await load('variants/shared.mjs?v=feedback-loop-1');
const { inputsOf } = await load('variants/inflow.mjs');
const frames = scenario.frames;
const FRAME = 22;
const channelOf = e => String(e.channel || e.stream).split(' · ')[0];
const rootOf = k => [...records[k].state.root.items].sort((a, b) => a.rank - b.rank).map(it => ({ id: it.id, share: it.share }));
const streamOf = {}; // item → the stream most of its inputs came from
{
  const feed = {};
  frames.forEach((f, k) => { if (k) for (const g of inputsOf(k, null).list) if (g.target) { const s = f.events[g.k].stream; (feed[g.target] ||= {})[s] = (feed[g.target][s] || 0) + 1; } });
  for (const [id, n] of Object.entries(feed)) streamOf[id] = Object.entries(n).sort((a, b) => b[1] - a[1])[0][0];
}
const asks = new Map();
for (const f of frames) for (const a of Object.values(f.asks || {})) asks.set(a.id, a);
const d = {
  total: frames.reduce((n, f) => n + f.events.length, 0),
  sources: new Set(frames.flatMap(f => f.events.map(channelOf))).size,
  streamsTotal: frames.flatMap(f => f.events).reduce((n, e) => ({ ...n, [e.stream]: (n[e.stream] || 0) + 1 }), {}),
  // Questions registered over the two weeks, and how many belong to a family item.
  askFamily: [[...asks.values()].filter(a => streamOf[a.item] === 'family').length, asks.size],
  // [hours since frames[0].at, channel] for every input: the app rows of d-notifications.
  stamps: frames.flatMap(f => f.events.map(e => [(Date.parse(e.at) - Date.parse(frames[0].at)) / 3600000, channelOf(e)])),
  // One column per round, a digit per input: 0 not used, 1 used, 2 fed an item that had a question for him that round.
  fieldAll: frames.slice(1).map((f, j) => { const k = j + 1, st = records[k].state; return inputsOf(k, null).list.map(g => (!g.target ? 0 : currentAsk({ index: k, state: st }, g.target) ? 2 : 1)).join(''); }),
  // Root shares per round in rank order: [share, has a question, id].
  review: records.slice(1).map((r, j) => [...r.state.root.items].sort((a, b) => a.rank - b.rank).map(it => [it.share, currentAsk({ index: j + 1, state: r.state }, it.id) ? 1 : 0, it.id])),
  perFrame: frames.map(f => ({ n: f.events.length, s: f.events.reduce((n, e) => ({ ...n, [e.stream]: (n[e.stream] || 0) + 1 }), {}) })),
  f22: (() => {
    const f = frames[FRAME], from = Date.parse(f.signal.window.from);
    return { n: f.events.length, half: inputsOf(FRAME, null).list.map(g => ({ m: Math.round((Date.parse(f.events[g.k].at) - from) / 60000), stream: f.events[g.k].stream, disp: g.disp, target: g.target || null })) };
  })(),
  // The two misjudged rounds as published (after the edits in prototype/data/composite/POLISH.md).
  f20: rootOf(20), f24: rootOf(24),
};

// ---------- the drawings ----------
const drawings = new Map();
const PAD = 12, W = 440;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r1 = n => Math.round(n * 100) / 100;
// text(x, y, s, cls, extra)
const T = (x, y, s, cls = 't', extra = '') => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" ${extra}>${esc(s)}</text>`;
const R = (x, y, w, h, cls, extra = '') => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" class="${cls}" ${extra}/>`;
const L = (x1, y1, x2, y2, cls, extra = '') => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" class="${cls}" ${extra}/>`;

const CSS = `
:root { --paper: oklch(0.975 0.006 95); --paper-2: oklch(0.992 0.004 95); --ink: oklch(0.21 0.014 155); --ink-2: oklch(0.47 0.014 150);
  --ink-3: oklch(0.68 0.010 140); --rule: oklch(0.885 0.008 95); --fold: oklch(0.82 0.008 95); --agent: oklch(0.80 0.008 140);
  --ver: oklch(0.60 0.19 35); --ver-soft: oklch(0.86 0.06 40); --g1: oklch(0.56 0.012 150); --g2: oklch(0.70 0.010 145); }
html, body { margin: 0; background: var(--paper-2); }
svg { display: block; }
text { font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif; fill: var(--ink); }
.t { font-size: 14px; }
.t2 { font-size: 14px; fill: var(--ink-2); }
.s { font-size: 13px; fill: var(--ink-2); }
.sm { font-size: 12px; fill: var(--ink-2); }
.b { font-size: 15px; font-weight: 600; }
.bb { font-size: 16px; font-weight: 600; }
.m { font-family: "SF Mono", SFMono-Regular, Menlo, monospace; font-size: 12px; fill: var(--ink-2); letter-spacing: 0.02em; }
.m3 { font-family: "SF Mono", SFMono-Regular, Menlo, monospace; font-size: 12px; fill: var(--ink-3); }
.mv { font-family: "SF Mono", SFMono-Regular, Menlo, monospace; font-size: 12px; fill: var(--ver); letter-spacing: 0.02em; }
.v { fill: var(--ver); }
.serif { font-family: "Songti SC", "STSong", serif; font-weight: 700; }
.ink { fill: var(--ink); } .ink2 { fill: var(--ink-2); } .ink3 { fill: var(--ink-3); } .fold { fill: var(--fold); } .agent { fill: var(--agent); }
.rulef { fill: var(--rule); } .ver { fill: var(--ver); } .versoft { fill: var(--ver-soft); } .paper { fill: var(--paper-2); } .g1 { fill: var(--g1); } .g2 { fill: var(--g2); }
.white { fill: #fff; }
.ln { stroke: var(--ink); stroke-width: 1; fill: none; }
.ln15 { stroke: var(--ink); stroke-width: 1.5; fill: none; }
.lr { stroke: var(--rule); stroke-width: 1; fill: none; }
.l3 { stroke: var(--ink-3); stroke-width: 1; fill: none; }
.lv { stroke: var(--ver); stroke-width: 1.5; fill: none; }
.dash { stroke-dasharray: 3 3; }
`;

// Each drawing is one SVG (#fig) on a page of its own, W wide plus the padding; Chrome shoots it at 2×.
function page(name, h, body) {
  const H = Math.ceil(h + 2 * PAD), TW = W + 2 * PAD;
  drawings.set(name, `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
<svg id="fig" xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${H}" viewBox="0 0 ${TW} ${H}"><rect width="${TW}" height="${H}" class="paper"/><g transform="translate(${PAD},${PAD})">${body}</g></svg>`);
}

const STREAM_CN = { work: '工作', community: '社区', life: '生活', family: '家里', subscription: '订阅' };

// ---------- 01 notifications: each app has an end; the Agent sees all of it ----------
{
  let s = '';
  s += T(0, 12, '以前 · 每个 App 只管自己的事', 'm');
  const apps = [['幼儿园的 App', 'Förskoleappen'], ['银行的 App', 'Bankappen'], ['学校的 App', 'Skolappen'], ['天气提醒', '天气']];
  const x0 = 92, x1 = 392, span = 336;
  const X = h => x0 + (Math.max(0, Math.min(span, h)) / span) * (x1 - x0);
  let y = 30;
  for (const [cn, key] of apps) {
    const hits = d.stamps.filter(st => st[1] === key);
    s += T(0, y + 13, cn, 't');
    s += L(x0, y + 16, x1, y + 16, 'lr');
    for (const [h] of hits) s += R(X(h) - 0.8, y + 3, 1.6, 13, 'ink2');
    s += T(W, y + 13, `${hits.length} 条`, 'm', 'text-anchor="end"');
    y += 26;
  }
  y += 18;
  s += L(0, y - 8, W, y - 8, 'lr');
  s += T(0, y + 12, '现在 · Agent 替你看着全部', 'm');
  s += T(W, y + 12, `${d.total} 条 · ${d.sources} 个来源`, 'm', 'text-anchor="end"');
  y += 24;
  // The field: one column per half day, one dot per input, arrival order bottom-up.
  const cols = d.fieldAll, n = cols.length, pitch = W / n, per = 5, dot = 2.1, step = 2.62;
  const maxRows = Math.ceil(Math.max(...cols.map(c => c.length)) / per), fh = maxRows * step;
  const fy = y;
  cols.forEach((col, i) => {
    const cx = i * pitch + (pitch - per * step) / 2;
    [...col].forEach((c, j) => {
      const r = Math.floor(j / per), k = j % per;
      s += R(cx + k * step, fy + fh - (r + 1) * step, dot, dot, c === '2' ? 'ver' : c === '1' ? 'ink2' : 'fold');
    });
  });
  y = fy + fh + 14;
  s += T(0, y, '8/3', 'm3'); s += T(W / 2, y, '每半天一列 · 一点一条', 'm3', 'text-anchor="middle"'); s += T(W, y, '8/17', 'm3', 'text-anchor="end"');
  y += 22;
  // The window: what one glance holds.
  const cx = W - 36, cy = y + 34, rr = 32;
  s += `<circle cx="${cx}" cy="${cy}" r="${rr}" class="ln15" style="fill: var(--paper-2)"/>`;
  s += T(cx, cy + 4, '2', 'serif', `text-anchor="middle" style="font-size:30px"`);
  s += T(cx, cy + 20, '件要紧', 'sm', 'text-anchor="middle" style="fill: var(--ver)"');
  s += T(0, cy - 8, '你在某一刻看得过来的：', 't');
  s += T(0, cy + 12, '抬腕看一眼，只有这么一小块。', 't');
  s += L(218, cy + 8, cx - rr - 8, cy + 8, 'l3');
  y = cy + rr;
  s += `<g transform="translate(0, ${y + 12})">`;
  s += R(0, -8, 8, 8, 'fold') + T(12, 0, '没用上', 'sm');
  s += R(64, -8, 8, 8, 'ink2') + T(76, 0, '用上了', 'sm');
  s += R(128, -8, 8, 8, 'ver') + T(140, 0, '为一件等他回应的事', 'sm');
  s += '</g>';
  page('d-notifications', y + 16, s);
}

// ---------- 02 half a day: 172 lines, two things ----------
{
  let s = '';
  const f = d.f22, x0 = 44, x1 = W, X = m => x0 + (m / 720) * (x1 - x0);
  s += T(0, 11, '8 月 13 日 中午 → 半夜', 'm');
  s += T(W, 11, `${f.n} 条`, 'm', 'text-anchor="end"');
  const lanes = ['work', 'community', 'subscription', 'life', 'family'];
  const lh = 30, top = 24;
  lanes.forEach((st, i) => {
    const y = top + i * lh;
    s += T(0, y + 19, STREAM_CN[st], 't');
    s += L(x0, y + lh - 4, x1, y + lh - 4, 'lr');
  });
  const two = new Set(['smilla-vet', 'mamma-stambyte']);
  const order = h => (two.has(h.target) ? 3 : h.target ? 2 : h.disp === 'noise' ? 0 : 1);
  for (const h of [...f.half].sort((a, b) => order(a) - order(b))) {
    const i = lanes.indexOf(h.stream), base = top + i * lh + lh - 4, x = X(h.m);
    if (two.has(h.target)) s += R(x - 1.2, base - 22, 2.4, 22, 'ver');
    else if (h.target) s += R(x - 0.75, base - 16, 1.5, 16, 'ink');
    else if (h.disp === 'noise') s += R(x - 0.75, base - 4, 1.5, 4, 'fold');
    else s += R(x - 0.75, base - 16, 1.5, 16, 'ink3');
  }
  // Brackets under the lanes for the two things.
  const by = top + lanes.length * lh + 6;
  const ms = f.half.filter(h => h.target === 'mamma-stambyte').map(h => h.m), cs = f.half.filter(h => h.target === 'smilla-vet').map(h => h.m);
  const bracket = (a, b, label) => `${L(X(a), by, X(a), by + 6, 'lv')}${L(X(a), by + 6, X(b), by + 6, 'lv')}${L(X(b), by, X(b), by + 6, 'lv')}${T((X(a) + X(b)) / 2, by + 22, label, 't', 'text-anchor="middle" style="fill: var(--ver); font-weight: 600"')}`;
  s += bracket(Math.min(...ms), Math.max(...ms), '母亲那六周住哪');
  s += bracket(Math.min(...cs), Math.max(...cs), '猫的药量');
  // The life-lane tick that belongs to the cat: a thin line down to its bracket.
  const lifeCat = f.half.find(h => h.target === 'smilla-vet' && h.stream === 'life');
  if (lifeCat) s += L(X(lifeCat.m), top + 4 * lh - 4, X(lifeCat.m), by, 'lv', 'stroke-width="0.8" stroke-dasharray="2 2"');
  const ay = by + 44;
  for (const [m, lab] of [[0, '12:00'], [180, '15:00'], [360, '18:00'], [540, '21:00'], [720, '24:00']]) {
    s += L(X(m), ay - 12, X(m), ay - 8, 'l3');
    s += T(Math.min(Math.max(X(m), x0 + 14), W - 16), ay + 2, lab, 'm3', 'text-anchor="middle"');
  }
  const ly = ay + 26;
  s += R(0, ly - 10, 1.5, 12, 'ink') + T(7, ly, '用上', 'sm');
  s += R(46, ly - 10, 1.5, 12, 'ink3') + T(53, ly, '先放下', 'sm');
  s += R(104, ly - 3, 1.5, 4, 'fold') + T(111, ly, '噪音', 'sm');
  s += R(150, ly - 12, 2.4, 14, 'ver') + T(158, ly, '跟那两件急事有关的几条', 'sm');
  page('d-half-day', ly + 4, s);
}

// ---------- 03 the front page of 8/14 00:00 ----------
{
  let s = '';
  s += L(0, 1, W, 1, 'ln', 'stroke-width="2"');
  s += L(0, 5, W, 5, 'ln', 'stroke-width="0.75"');
  s += T(W / 2, 36, 'Jonas 的头版', 'serif', 'text-anchor="middle" style="font-size:24px"');
  s += T(0, 56, '8 月 14 日 周五 · 零点', 'm');
  s += T(W, 56, '11 件 · 5 件等你', 'm', 'text-anchor="end"');
  const gy = 64, cw = W / 8, ch = 44;
  s += L(0, gy, W, gy, 'ln');
  const box = (c, r, w, h) => [c * cw, gy + r * ch, w * cw, h * ch];
  const frame = (c, r, w, h) => { const [x, y, ww, hh] = box(c, r, w, h); return R(x, y, ww, hh, 'lr', 'style="fill:none"'); };
  // Lead stories.
  const lead = (c, kick, head, body) => {
    const [x, y] = box(c, 0, 4, 6); let o = frame(c, 0, 4, 6);
    o += T(x + 12, y + 22, kick, 'mv');
    head.forEach((ln, i) => { o += T(x + 12, y + 50 + i * 25, ln, 'serif', 'style="font-size:18px"'); });
    body.forEach((ln, i) => { o += T(x + 12, y + 56 + head.length * 25 + 6 + i * 19, ln, 's'); });
    o += T(x + 4 * cw - 10, y + 6 * ch - 10, '24 份', 'm3', 'text-anchor="end"');
    return o;
  };
  s += lead(0, '● 等你选 · 今晚截止', ['母亲楼里换水管，', '那六周住哪？'], ['今天 23:59 前要答复：', '住我们家、去临时公寓，', '还是各住一段。', '昨晚已经通过电话。']);
  s += lead(4, '● 等你选 · 八点前', ['猫可能多吃了药：', '打给诊所，', '还是先观察？'], ['一天约 7 毫克每公斤，', '有说法超过 5 就可能失明。', '伴侣要你八点整打。']);
  // Second row.
  { const [x, y] = box(0, 6, 3, 2); s += frame(0, 6, 3, 2); s += T(x + 12, y + 20, '● 等你批准', 'mv'); s += T(x + 12, y + 44, '同事修好一个漏洞，', 'serif', 'style="font-size:14.5px"'); s += T(x + 12, y + 64, '等你评审', 'serif', 'style="font-size:14.5px"'); s += T(x + 3 * cw - 8, y + 2 * ch - 8, '6 份', 'm3', 'text-anchor="end"'); }
  { const [x, y] = box(3, 6, 3, 1); s += frame(3, 6, 3, 1); s += T(x + 10, y + 17, '● 等你去做', 'mv'); s += T(x + 10, y + 35, '儿子退烧了，记得报护理假', 's', 'style="font-size:11.5px; fill: var(--ink)"'); }
  const briefs = [[6, 6, ['开学', '同意书'], true], [7, 6, ['女儿的', '漫画'], false], [3, 7, ['车道', '潮湿'], false], [4, 7, ['测试', '仍没过'], false], [5, 7, ['漏洞', '补丁'], false], [6, 7, ['新车', '刹车'], false], [7, 7, ['测试版', '已发'], false]];
  for (const [c, r, lines, ask] of briefs) {
    const [x, y] = box(c, r, 1, 1); s += frame(c, r, 1, 1);
    lines.forEach((ln, i) => { s += T(x + 7 + (ask && i === 0 ? 8 : 0), y + 18 + i * 15, ln, 'sm', `style="fill: var(--ink)"`); });
    if (ask) s += `<circle cx="${x + 10}" cy="${y + 14}" r="2.6" class="ver"/>`;
  }
  s += R(0, gy, W, 8 * ch, 'ln', 'style="fill:none"');
  s += T(0, gy + 8 * ch + 20, '版面排满了', 'm3');
  s += T(W, gy + 8 * ch + 20, '● 等他回应', 'mv', 'text-anchor="end"');
  page('d-front-page', gy + 8 * ch + 24, s);
}

// ---------- 03b returned whole ----------
{
  let s = '';
  s += T(0, 11, '示意 · 版面的大小是固定的', 'm');
  const cell = 12.5, pw = cell * 8, top = 30;
  const xs = [0, 168, 336];
  // Cells: [col,row,cls]
  const fill = (cells, x0, extra = '') => cells.map(([c, r, cls]) => R(x0 + c * cell + 0.6, top + r * cell + 0.6, cell - 1.2, cell - 1.2, cls, extra)).join('');
  const block = (c0, r0, w, h, cls) => { const o = []; for (let r = r0; r < r0 + h; r += 1) for (let c = c0; c < c0 + w; c += 1) o.push([c, r, cls]); return o; };
  const base = [...block(0, 0, 4, 6, 'versoft'), ...block(4, 0, 4, 6, 'versoft')];
  const grown = [...base, ...block(0, 6, 6, 2, 'ink'), ...block(6, 6, 2, 2, 'agent')];
  const over = [[8, 6], [9, 6], [10, 6], [8, 7], [9, 7], [10, 7]];
  const hatch = `<pattern id="h" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="var(--paper-2)"/><line x1="0" y1="0" x2="0" y2="4" stroke="var(--ink-2)" stroke-width="1.4"/></pattern>`;
  s += `<defs>${hatch}</defs>`;
  // ① handed in
  s += fill(grown, xs[0]) + over.map(([c, r]) => R(xs[0] + c * cell + 0.6, top + r * cell + 0.6, cell - 1.2, cell - 1.2, '', 'fill="url(#h)"')).join('');
  s += R(xs[0], top, pw, pw, 'ln15');
  // ② returned: the same, faded, with the note
  s += `<g opacity="0.35">${fill(grown, xs[1])}${over.map(([c, r]) => R(xs[1] + c * cell + 0.6, top + r * cell + 0.6, cell - 1.2, cell - 1.2, '', 'fill="url(#h)"')).join('')}</g>`;
  s += R(xs[1], top, pw, pw, 'ln15');
  s += R(xs[1] + 10, top + pw / 2 - 17, pw - 20, 34, 'paper', 'style="stroke: var(--ink); stroke-width: 1.5"');
  s += T(xs[1] + pw / 2, top + pw / 2 + 5, '整份退回', 'b', 'text-anchor="middle"');
  // ③ fixed by itself
  const fixed = [...base, ...block(0, 6, 6, 2, 'ink'), [6, 6, 'versoft'], [7, 6, 'versoft'], [6, 7, 'versoft'], [7, 7, 'versoft']];
  s += fill(fixed, xs[2]) + R(xs[2], top, pw, pw, 'ln15');
  // arrows
  for (const ax of [xs[0] + pw + 26, xs[1] + pw + 26]) s += `<path d="M${ax} ${top + pw / 2} h26 m-6 -5 l6 5 l-6 5" class="ln"/>`;
  const labels = [['它交上来：', '评审放大一倍，', '超出版面 6 份'], ['规则只检查：', '一份也不替它挪，', '写明超了多少'], ['它自己定：', '撤下 6 件小事，', '再交，收下']];
  labels.forEach((ls, i) => ls.forEach((ln, j) => { s += T(xs[i], top + pw + 22 + j * 18, ln, j ? 's' : 't', j ? '' : 'style="font-weight:600"'); }));
  const ly = top + pw + 22 + 3 * 18 + 8;
  s += R(0, ly - 9, 9, 9, 'versoft') + T(13, ly, '等他回应的', 'sm');
  s += R(90, ly - 9, 9, 9, 'ink') + T(103, ly, '这一次放大的', 'sm');
  s += R(192, ly - 9, 9, 9, 'agent') + T(205, ly, '小事', 'sm');
  s += R(246, ly - 9, 9, 9, '', 'fill="url(#h)"') + T(259, ly, '放不下的', 'sm');
  page('d-returned', ly + 4, s);
}

// ---------- 04 two weeks, five streams ----------
{
  let s = '';
  const streams = [['family', '家里', '伴侣、孩子、母亲、邻居，照真实的语气写成', 'ink'], ['life', '生活', '生活问答站上的真实提问', 'ink2'], ['work', '工作', '一位开源维护者两周的公开往来', 'ink3'], ['community', '社区', '一个自然观察论坛', 'agent'], ['subscription', '订阅', '周刊、天气提醒', 'rulef']];
  streams.forEach(([key, cn, desc, cls], i) => {
    const y = i * 21;
    s += R(0, y + 3, 10, 10, cls) + T(16, y + 12, cn, 't', 'style="font-weight:600"') + T(48, y + 12, desc, 's');
    s += T(W, y + 12, String(d.streamsTotal[key]), 'm', 'text-anchor="end"');
  });
  const top = 5 * 21 + 18, ch = 132, frames = d.perFrame.slice(1), n = frames.length, pitch = W / n, bw = pitch - 3;
  const max = 240;
  frames.forEach((f, i) => {
    let y = top + ch;
    for (const [key, , , cls] of streams) { const h = ((f.s[key] || 0) / max) * ch; if (h > 0) { s += R(i * pitch + 1.5, y - h, bw, h, cls); y -= h; } }
  });
  s += L(0, top + ch + 0.5, W, top + ch + 0.5, 'ln');
  const ay = top + ch + 15;
  s += T(0, ay, '8/3', 'm3'); s += T(W / 2, ay, '每半天一列', 'm3', 'text-anchor="middle"'); s += T(W, ay, '8/17', 'm3', 'text-anchor="end"');
  // Composition: what comes in, against what asks him.
  const fam = d.streamsTotal.family / d.total, askShare = d.askFamily[0] / d.askFamily[1];
  const by = ay + 26, bx = 116, bw2 = W - bx;
  const bar = (y, label, share, note) => `${T(0, y + 11, label, 't')}${R(bx, y, bw2 * share, 14, 'ink')}${R(bx + bw2 * share, y, bw2 * (1 - share), 14, 'agent')}${T(bx + bw2 * share + 6, y + 11, note, 'sm', 'style="fill: var(--ink)"')}`;
  s += bar(by, '进来的消息', fam, '家里约占八分之一');
  s += bar(by + 26, '要他回答的问题', askShare, '家里占一半');
  page('d-two-weeks', by + 26 + 16, s);
}

// ---------- 05 three runs ----------
{
  let s = '';
  s += T(0, 12, '从一张白纸开始，每半天整理一次，连跑两周', 't', 'style="font-weight:600"');
  const runs = [['第一遍', 4], ['第二遍', 3], ['第三遍', 3]];
  const x0 = 54, sq = 11.2, gap = 2.6, top = 30;
  runs.forEach(([name, again], i) => {
    const y = top + i * 22;
    s += T(0, y + 10, name, 't');
    for (let k = 0; k < 28; k += 1) s += R(x0 + k * (sq + gap), y, sq, sq, 'ink');
  });
  let y = top + 3 * 22 + 12;
  s += T(0, y, '每一轮都交上了一份合规的头版。', 's');
  s += T(0, y + 18, '偶尔第一次超了字数，看到退回的说明，下一次就改对了。', 's');
  y += 46;
  s += L(0, y, W, y, 'lr');
  y += 24;
  s += T(0, y, '它判成噪音的，十条里：', 't', 'style="font-weight:600"');
  y += 18;
  for (let k = 0; k < 10; k += 1) s += `<circle cx="${12 + k * 26}" cy="${y + 12}" r="9" class="${k < 9 ? 'ink' : ''}" ${k < 9 ? '' : 'style="fill: var(--paper-2); stroke: var(--ink); stroke-width: 1.5"'}/>`;
  s += T(274, y + 8, '九条，他后来确实没理会', 'sm', 'style="fill: var(--ink)"');
  s += T(274, y + 24, '一条，后来又理了', 'sm');
  page('d-runs', y + 26, s);
}

// ---------- 06 two mistakes ----------
{
  let s = '';
  const x0 = 50, rw = W - x0, cw = rw / 64, rh = 16;
  const ruler = (y, shares, hi, note, noteCls = 'sm') => {
    let o = '', x = x0;
    for (const [sh, id] of shares) { o += R(x + 0.5, y + 0.5, sh * cw - 1, rh - 1, id === hi ? 'ink' : 'agent'); x += sh * cw; }
    o += R(x0, y, rw, rh, 'ln');
    for (let k = 0; k <= 64; k += 8) o += L(x0 + k * cw, y + rh, x0 + k * cw, y + rh + 4, 'l3');
    o += T(x0, y + rh + 17, note, noteCls, 'style="fill: var(--ink)"');
    return o;
  };
  const byRank = rows => rows.map(r => [r.share, r.id]);
  // Case A, f20: the Agent gave the boy 1 share at the tail; the edit made it 3 and dropped one 1-share item.
  const a20 = byRank(d.f20);
  const aGiven = [...a20.filter(([, id]) => id !== 'ture-pickup-0812'), [1, 'benchmark'], [1, 'ture-pickup-0812']];
  const aFixed = a20;
  let y = 0;
  s += T(0, y + 14, '儿子发烧，伴侣在手术室走不开', 'b');
  y += 26;
  s += T(0, y + 12, '它给的', 's') + ruler(y, aGiven, 'ture-pickup-0812', '只有 1 份，排在最后；手机首页会把它收进“其余”里');
  y += 44;
  s += T(0, y + 12, '改成', 's') + ruler(y, aFixed, 'ture-pickup-0812', '3 份');
  y += 52;
  // Case B, f24: the misdirected ride got 12 and the top rank; the edit made it 3.
  const b24 = byRank(d.f24);
  const bGiven = [[12, 'joakim-ride-16'], ...b24.filter(([, id]) => id !== 'joakim-ride-16')];
  s += T(0, y + 14, '朋友把“明早九点骑车”发错了群', 'b');
  y += 26;
  s += T(0, y + 12, '它给的', 's') + ruler(y, bGiven, 'joakim-ride-16', '12 份，排在第一');
  y += 44;
  s += T(0, y + 12, '改成', 's') + ruler(y, b24, 'joakim-ride-16', '3 份，仍等他回一句');
  y += 56;
  s += T(0, y + 4, '一条框是那一轮的整份头版：黑的是这件事，灰的是其余各件。', 'sm');
  page('d-mistakes', y + 8, s);
}

// ---------- 07 one moment, four windows ----------
{
  let s = '';
  const f22 = d.review[21];
  const bottom = 214;
  // Watch: a circle.
  { const r = 50, cx = r + 2, cy = bottom - r;
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" class="ln15" style="fill: var(--paper-2)"/>`;
    s += T(cx, cy + 2, '2', 'serif', 'text-anchor="middle" style="font-size:34px"');
    s += T(cx, cy + 18, '件要紧', 'sm', 'text-anchor="middle" style="fill: var(--ver)"');
    s += T(cx, cy + 33, '猫：打诊所？', 'sm', 'text-anchor="middle" style="fill: var(--ink); font-size:10px"');
    s += T(0, bottom + 22, '抬腕', 'b') + T(38, bottom + 22, '两秒', 'm');
  }
  // Phone: a tall rounded window with two question cards.
  { const x = 118, w = 116, h = 204, y = bottom - h;
    s += R(x, y, w, h, 'ln15', 'rx="18" style="fill: var(--paper-2)"');
    s += T(x + 12, y + 26, '5 件等你', 'b', 'style="font-size:13px"');
    const card = (cy, title, nBtn) => {
      let o = R(x + 8, cy, w - 16, nBtn === 2 ? 66 : 62, '', 'rx="7" style="fill: #fff; stroke: var(--rule)"');
      o += T(x + 15, cy + 16, title, 'sm', 'style="fill: var(--ink); font-size:10.5px; font-weight:600"');
      o += R(x + 15, cy + 24, w - 40, 3, 'rulef') + R(x + 15, cy + 31, w - 54, 3, 'rulef');
      const bw = (w - 30 - (nBtn - 1) * 4) / nBtn;
      for (let k = 0; k < nBtn; k += 1) o += R(x + 15 + k * (bw + 4), cy + 42, bw, 14, k === 0 && nBtn === 2 ? 'ver' : '', `rx="7" ${k === 0 && nBtn === 2 ? '' : 'style="fill: #fff; stroke: var(--ver)"'}`);
      return o;
    };
    s += card(y + 38, '猫：打诊所？', 2);
    s += card(y + 112, '母亲住哪？', 3);
    s += T(x + 12, y + h - 12, '另有 3 件 ›', 'sm', 'style="font-size:10px"');
    s += T(x, bottom + 22, '掏手机', 'b') + T(x + 54, bottom + 22, '一分钟', 'm');
  }
  // Desk: the whole front page as areas.
  { const x = 250, w = 190, h = 124, y = bottom - h;
    s += R(x, y, w, h, 'ln15', 'rx="6" style="fill: var(--paper-2)"');
    const ix = x + 5, iy = y + 5, iw = w - 10, ih = h - 10, cw = iw / 8, chh = ih / 8;
    const cell = (c, r, ww, hh, cls, label, lc) => `${R(ix + c * cw + 0.75, iy + r * chh + 0.75, ww * cw - 1.5, hh * chh - 1.5, cls, 'rx="2.5"')}${label ? T(ix + c * cw + 6, iy + r * chh + 15, label, 'sm', `style="font-size:10.5px; font-weight:600; fill:${lc}"`) : ''}`;
    s += cell(0, 0, 4, 6, 'ver', '母亲', '#fff') + cell(4, 0, 4, 6, 'ver', '猫', '#fff');
    s += cell(0, 6, 3, 2, 'versoft', '评审', 'var(--ink)') + cell(3, 6, 3, 1, 'versoft', '', '');
    for (const [c, r, cls] of [[6, 6, 'versoft'], [7, 6, 'agent'], [3, 7, 'agent'], [4, 7, 'agent'], [5, 7, 'agent'], [6, 7, 'agent'], [7, 7, 'agent']]) s += cell(c, r, 1, 1, cls, '', '');
    s += T(x, bottom + 22, '坐到桌前', 'b') + T(x + 69, bottom + 22, '几分钟', 'm');
  }
  // Review: two weeks of rounds as bars, the last one is this moment.
  { const y0 = bottom + 48, h = 112, x = 0, w = W;
    s += R(x, y0, w, h, 'ln15', 'rx="6" style="fill: var(--paper-2)"');
    const rounds = d.review.slice(0, 22), n = rounds.length, ix = x + 10, iw = w - 20, pitch = iw / n, bw = pitch - 4, ib = y0 + h - 22, ih = h - 32;
    rounds.forEach((items, i) => {
      let yy = ib; const last = i === n - 1;
      items.forEach(([sh, ask], rank) => {
        const hh = (sh / 64) * ih;
        const cls = last ? (ask ? (rank < 2 ? 'ver' : 'versoft') : 'agent') : rank === 0 ? 'g1' : rank < 3 ? 'g2' : 'agent';
        s += R(ix + i * pitch + 2, yy - hh + 0.5, bw, Math.max(0.5, hh - 1), cls);
        yy -= hh;
      });
    });
    s += T(ix, y0 + h - 8, '8/3', 'm3') + T(ix + iw, y0 + h - 8, '此刻', 'm3', 'text-anchor="end"');
    s += T(0, y0 + h + 22, '周末复盘', 'b') + T(69, y0 + h + 22, '半小时', 'm');
    page('d-windows', y0 + h + 26, s);
  }
}

// ---------- 12 saved, received, done ----------
{
  let s = '';
  // The question.
  const qh = 104;
  s += R(0.75, 0.75, W - 1.5, qh, '', 'rx="12" style="fill:#fff; stroke: var(--ver); stroke-width: 1.5"');
  s += T(16, 24, '等你选 · 八点前', 'mv');
  s += T(16, 48, '猫可能多吃了药：打给诊所，还是先观察？', 'bb');
  s += R(16, 64, 150, 30, 'ver', 'rx="15"') + T(91, 84, '打给诊所', 't', 'text-anchor="middle" style="fill:#fff; font-weight:600"');
  s += R(176, 64, 150, 30, '', 'rx="15" style="fill:#fff; stroke: var(--ver); stroke-width: 1.2"') + T(251, 84, '先观察', 't', 'text-anchor="middle" style="fill: var(--ver); font-weight:600"');
  let y = qh + 10;
  const step = (label) => { const o = `${L(28, y, 28, y + 26, 'l3')}<path d="M24 ${y + 21} l4 5 l4 -5" class="l3"/>${T(42, y + 18, label, 'm')}`; y += 34; return o; };
  const receipt = (icon, title, line, extra = [], dashed = false) => {
    const h = 58 + extra.length * 19;
    let o = R(0.75, y, W - 1.5, h, '', `rx="12" style="fill:#fff; stroke: ${dashed ? 'var(--ink-3)' : 'var(--rule)'}; ${dashed ? 'stroke-dasharray: 4 3;' : ''}"`);
    o += icon(28, y + 29);
    o += T(54, y + 25, title, 'b');
    o += T(54, y + 45, line, 's');
    extra.forEach((ln, i) => { o += T(54, y + 66 + i * 19, ln, 's', 'style="fill: var(--ink)"'); });
    y += h;
    return o;
  };
  const ring = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="11" class="ln15"/><path d="M${cx - 5} ${cy} l3.5 3.5 l6.5 -7" class="ln15"/>`;
  const filled = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="11" class="ink"/><path d="M${cx - 5} ${cy} l3.5 3.5 l6.5 -7" style="stroke:#fff; stroke-width:1.8; fill:none"/>`;
  const flag = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="11" style="fill: var(--paper-2); stroke: var(--ink); stroke-width:1.5; stroke-dasharray: 3 2.4"/><path d="M${cx - 5} ${cy} l3.5 3.5 l6.5 -7" class="ln15"/>`;
  s += step('① 他在手机上按下「打给诊所」');
  s += receipt(ring, '已保存', '只记在这一页。头版还没变，Agent 还不知道。');
  y += 0;
  s += step('② 12:00 下一轮整理');
  s += receipt(filled, '已收到', 'Agent 读到了这个回答，写进这一轮的回执。');
  s += step('③ 同一轮，它还读到了这两条消息');
  s += receipt(flag, '办成', '事情真的变了，要从之后的消息里看出来：', ['08:02 打给动物诊所，通话 6 分钟', '08:15 诊所短信：药量减到四分之一片，24 日复诊', '猫这件从 24 份缩到 12 份，改为“已减量”'], true);
  page('d-receipts', y + 2, s);
}

// ---------- 14 the ladder of evidence ----------
{
  let s = '';
  const rungs = [
    ['让真人来读、来用', '离开半天回来，能不能很快认出要自己处理的事', '还没有做 · 最后要回答的问题', false],
    ['同样的条件多跑几遍', '看结果稳不稳，换个写法会不会变', '还没有做', false],
    ['真实的两周跑下来', '三遍，每一轮都交上了合规的头版', '已经有', true],
    ['逐帧对照作者的答案', '该不该用，十条里九条一样', '已经有', true],
    ['规则守得住', '超了就整份退回；用例逐条检查', '已经有', true],
  ];
  const rh = 62;
  s += L(14, 14, 14, 14 + (rungs.length - 1) * rh, 'l3');
  rungs.forEach(([t, sub, st, done], i) => {
    const y = i * rh;
    s += done ? `<circle cx="14" cy="${y + 14}" r="11" class="ink"/><path d="M9 ${y + 14} l3.5 3.5 l6.5 -7" style="stroke:#fff; stroke-width:1.8; fill:none"/>`
      : `<circle cx="14" cy="${y + 14}" r="11" style="fill: var(--paper-2); stroke: var(--ink-3); stroke-width: 1.5; stroke-dasharray: 3 2.4"/>`;
    s += T(38, y + 13, t, 'b', done ? '' : 'style="fill: var(--ink-2)"');
    s += T(38, y + 32, sub, 's');
    s += T(W, y + 13, st, 'm', 'text-anchor="end"');
  });
  page('d-ladder', (rungs.length - 1) * rh + 40, s);
}

// ---------- the prototype pictures ----------
// clip is in CSS pixels; scale is the device pixel ratio; resize is the webp's width when it differs from the capture.
const reply = "(() => { const b = document.querySelector('.d-card [data-rs-act]'); b.click(); return 1; })()";
const deferThenNext = `(async () => { window.foldC.defer('ture-pickup-0812', Date.parse('2026-08-14T18:00:00+02:00'));
  await new Promise(r => setTimeout(r, 800)); [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '下一次整理').click(); return 1; })()`;
const shots = [
  { name: 'watch-face-f22', url: '/forms/watch.html?frame=22', size: [1440, 900], scale: 3, clip: [50, 188, 304, 368], resize: 700 },
  { name: 'watch-reply-f22', url: '/forms/watch.html?frame=22', size: [1440, 900], scale: 3, clip: [746, 188, 304, 368], resize: 700 },
  { name: 'desk-f22', url: '/index.html?frame=22', size: [1024, 820], scale: 2, clip: [255, 196, 434, 458], eval: "document.documentElement.classList.add('is-embedded'); document.querySelector('[data-card]')?.click(); 1" },
  { name: 'time-f22', url: '/index.html?variant=b&frame=22', size: [430, 932], mobile: true, scale: 3, clip: [0, 146, 430, 636], resize: 860 },
  { name: 'defer-f23', url: '/index.html?variant=c&frame=22', size: [430, 932], mobile: true, scale: 3, clip: [0, 145, 430, 690], resize: 860, eval: deferThenNext, settle: 5000 },
  { name: 'review-week2-f22', url: '/forms/multiples.html?frame=22', size: [1180, 900], scale: 3, clip: [266, 386, 204, 362], before: 4000 },
  { name: 'review-trend-f22', url: '/forms/multiples.html?frame=22', size: [1180, 900], scale: 3, clip: [516, 389, 302, 498], resize: 700, before: 4000 },
  { name: 'try-f22', url: '/index.html?variant=d&frame=22', size: [1180, 820], scale: 3, clip: [604, 24, 329, 702], resize: 700, eval: reply, before: 3000, settle: 1200 },
];

// ---------- Chrome ----------
const profile = await mkdtemp(path.join(tmpdir(), 'fold-why-figures-'));
const work = await mkdtemp(path.join(tmpdir(), 'fold-why-svg-'));
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
const endpoint = await new Promise((done, fail) => {
  let text = '';
  chrome.stderr.on('data', chunk => { text += chunk; const m = text.match(/DevTools listening on (ws:\/\/\S+)/); if (m) done(m[1]); });
  chrome.on('exit', code => fail(new Error(`Chrome exited (${code})`)));
  setTimeout(() => fail(new Error('Chrome did not start')), 15000);
});
const socket = new WebSocket(endpoint);
await new Promise(done => { socket.onopen = done; });
let nextId = 0;
const pending = new Map();
socket.onmessage = event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { const { done, fail } = pending.get(m.id); pending.delete(m.id); m.error ? fail(new Error(m.error.message)) : done(m.result); } };
const send = (method, params = {}, sessionId) => new Promise((done, fail) => { const m = { id: ++nextId, method, params, ...(sessionId ? { sessionId } : {}) }; pending.set(m.id, { done, fail }); socket.send(JSON.stringify(m)); });

async function capture({ url, size: [width, height], scale, mobile = false, clip, eval: script, before = 2500, settle = 600, select }) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  const evaluate = async expression => {
    const { result, exceptionDetails } = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(`${url}: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
    return result.value;
  };
  try {
    await s('Page.enable');
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
    if (mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await s('Page.navigate', { url });
    for (let i = 0; i < 100; i += 1) { if (await evaluate('document.readyState') === 'complete') break; await wait(100); }
    await evaluate('document.fonts.ready.then(() => 1)');
    await wait(before);
    if (script) { await evaluate(script); await wait(settle); }
    if (select) { const r = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(select)}).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`); clip = r; }
    const [x, y, w, h] = clip;
    const { data } = await s('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: 1 }, captureBeyondViewport: true });
    return Buffer.from(data, 'base64');
  } finally {
    await send('Target.closeTarget', { targetId });
  }
}

function webp(png, name, { quality, resize }) {
  const source = path.join(work, `${name}.png`);
  return writeFile(source, png).then(() => {
    const result = spawnSync('cwebp', ['-quiet', '-q', String(quality), '-m', '6', '-sharp_yuv', ...(resize ? ['-resize', String(resize), '0'] : []), source, '-o', path.join(out, `${name}.webp`)], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`cwebp ${name}: ${result.stderr || result.error}`);
  });
}

try {
  await mkdir(out, { recursive: true });
  const wanted = name => !only || only.includes(name);
  for (const [name, html] of drawings) {
    if (!wanted(name)) continue;
    const file = path.join(work, `${name}.html`);
    await writeFile(file, html);
    await webp(await capture({ url: pathToFileURL(file).href, size: [520, 1400], scale: 2, before: 300, select: '#fig' }), name, { quality: 84 });
    console.log(`画好 ${name}.webp`);
  }
  if (!args.includes('--drawings')) {
    for (const shot of shots) {
      if (!wanted(shot.name)) continue;
      await webp(await capture({ ...shot, url: base + shot.url }), shot.name, { quality: 82, resize: shot.resize });
      console.log(`拍好 ${shot.name}.webp`);
    }
  }
} finally {
  socket.close();
  chrome.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
