// 交互检查：用真的输入事件（CDP 鼠标、键盘、触屏）逐项走一遍共用交互模块（prototype/forms/motion/ix.mjs）的标准：
// 悬停出概要卡并停住播放、命中区放宽、移开后宽限与恢复、点击展开并切到“这一件”、Esc / 再点 / 点空白收回、
// Tab + Enter 展开且焦点进卡、Esc 后焦点回到事项、触屏两下、连播中悬停不进下一轮、移开后接着播、→ 立即收起。
// 共 16 项，每个接入 ix.mjs 的页面都跑同一套；各页只在 PAGES 里写自己的地址、挑哪一件、怎样算“切到这一件”。
// D 手机首页（home）没有悬停，另走一套触屏流程（runHome，iPhone 尺寸、CDP 触屏事件）：长按代替悬停、轻点从卡长出详情、
// 下拉收回、左滑知道了、作答与撤回、手指保护、换轮时回执跟着条目走，以及键盘与连播的同一组打断规则。
// E 折叠屏（duo）走 runDuo：同一组触屏标准，加铰链、左页详情、色带格联动与讲一遍。
// 回应托盘（trays）也是触屏，走 runTrays：同一组触屏规则，加上托盘高度 = 几下、两下的托盘一下矮一排、直接打开讲一遍。
// 只用 Node 22 内置的 WebSocket 驱动本机 Chrome（无头），不装依赖。原型需先在本地提供服务。
//
//   node scripts/check-ix.mjs --base http://127.0.0.1:4173                 # 全部页面，默认数据
//   node scripts/check-ix.mjs --base http://127.0.0.1:4173 --data story --only dial
//
// 任一项不过时退出码为 1。CHROME 环境变量可指定浏览器路径。
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Each page: where to open it (a held frame, and a playing one), the window hook, which item to use, a point 9 px
// outside that item's drawn geometry (still inside the widened hit band), a blank point, whether the page has cut to
// “这一件”, how to read the round on screen, and (tabFrom) the control the Tab test starts from if not the bar's [data-card].
const PAGES = {
  pulse: {
    hook: 'foldPulse', held: 'forms/motion/pulse.html?frame=20&card=0', play: 'forms/motion/pulse.html?from=19&card=0',
    prepare: 'foldPulse.seek(20, 4.25)', index: 'foldPulse.index', step: 21,
    pick: `foldPulse.geom().sort((a, b) => b.share - a.share)[0].short`,
    // Perpendicular to the branch, 9 px off its middle (the lines are thin; the band is 10 px either side).
    near: name => `(() => { const g = foldPulse.geom().find(x => x.short === ${JSON.stringify(name)}); const a = g.tip * Math.PI / 180; const p = foldPulse.pointOf(${JSON.stringify(name)}); return { x: p.x + Math.cos(a) * 9, y: p.y + Math.sin(a) * 9 }; })()`,
    blank: { x: 1300, y: 120 },
    cut: `document.querySelector('.pl-signal').textContent.startsWith('这一件') && document.querySelector('[data-p="round"] h3').textContent.startsWith('这一件')`,
    // Playing on from f19: wait for f20 to have played through before hovering its largest branch.
    playReady: `new Promise(r => { const go = () => (foldPulse.index === 20 ? r(1) : setTimeout(go, 50)); go(); }).then(() => new Promise(r => setTimeout(r, 4300)))`,
  },
  dial: {
    hook: 'foldDial', held: 'forms/motion/dial.html?frame=26&card=0', play: 'forms/motion/dial.html?mode=play&card=0',
    prepare: null, index: 'foldDial.player.index', step: 27,
    // The largest sector other than the cursor's (the cursor's own note grows in place instead of opening a card).
    pick: `(() => { const r = foldDial.rounds[foldDial.player.index]; return [...r.sectors].filter(s => s.id !== r.cursor?.root).sort((a, b) => b.share - a.share)[0].short; })()`,
    // Just outside the rim, along the sector's middle (sectors are hit by angle up to R + 16).
    near: name => `(() => { const p = foldDial.pointOf(${JSON.stringify(name)}), g = foldDial.geom(), box = document.querySelector('.dl-main').getBoundingClientRect(); const dx = p.x - box.left - g.cx, dy = p.y - box.top - g.cy, d = Math.hypot(dx, dy); return { x: box.left + g.cx + dx / d * (g.R + 9), y: box.top + g.cy + dy / d * (g.R + 9) }; })()`,
    blank: { x: 60, y: 600 },
    cut: `document.querySelector('.dl-kicker').textContent.startsWith('这一件') && document.querySelector('.dl-p h4').textContent.includes('这一件')`,
    playReady: `new Promise(r => { const go = () => (foldDial.player.index >= 3 ? r(1) : setTimeout(go, 50)); go(); })`,
  },
  watch: {
    hook: 'foldWatch', held: 'forms/watch.html?frame=26&card=0', play: 'forms/watch.html?frame=3&card=0',
    prepare: null, index: 'foldWatch.index', step: 27,
    // The shell's bar ends with “状态”; the ring's hidden buttons come right after it.
    tabFrom: '[data-inspect="state"]',
    pick: `foldWatch.ring().sort((a, b) => b.share - a.share)[0].short`,
    // Just outside the rim, along the segment's middle (ticks are hit by angle up to 14 px past the rim).
    near: name => `(() => { const g = foldWatch.geom(), seg = foldWatch.ring().find(x => x.short === ${JSON.stringify(name)}); return { x: g.cx + Math.cos(seg.a) * (g.outer + 9), y: g.cy + Math.sin(seg.a) * (g.outer + 9) }; })()`,
    blank: { x: 1380, y: 300 },
    cut: `document.querySelector('.w-lede').textContent.startsWith('这一件')`,
    // Play on from f03 (the page counts 5.6 s a round from the cut); hover once the turn has settled.
    playReady: `new Promise(r => { foldWatch.play(); setTimeout(r, 1700); })`,
  },
  // 批次记谱：一行就是“一件”（这一轮），打开它时此刻跳到那一行，所以挑此刻这一行；详情就是侧栏。
  notation: {
    hook: 'foldNotation', held: 'forms/sketches/notation.html?frame=20', play: 'forms/sketches/notation.html?frame=2',
    prepare: null, index: 'foldSketch.index', step: 21,
    pick: '`row:${foldSketch.index}`',
    // 9 px past the end of the row's bar, level with it: still the row (a row is hit across its whole height and width).
    near: name => `(() => { const b = foldNotation.geom(${JSON.stringify(name)}); return { x: b.x1 + 9, y: (b.y0 + b.y1) / 2 }; })()`,
    blank: { x: 700, y: 92 },
    cut: `(() => { const d = document.querySelector('.n-body > .ix-detail'); return Boolean(d && !d.hidden && d.style.visibility !== 'hidden' && /^这一(轮|件)/.test(d.querySelector('.st-side-kicker')?.textContent || '')); })()`,
    playReady: `(foldSketch.play(), new Promise(r => setTimeout(r, 1700)))`,
    // No concept card here: Tab starts from the frame bar's last control, the tick strip.
    tabFrom: '.st-ticks',
  },
  multiples: {
    // Opened at the top level without a frame the page plays its show once by itself; with ?frame= it stays still.
    hook: 'foldMultiples', held: 'forms/multiples.html?frame=23&card=0', play: 'forms/multiples.html?card=0',
    prepare: null, index: 'foldMultiples.player.index', step: 24, tabFrom: '[data-inspect="state"]',
    // The largest item of the frame on screen: its block starts at the big waffle's first cell.
    pick: `foldMultiples.rounds[foldMultiples.player.index].items[0].short`,
    // 9 px above the big waffle, over the item's first row (the waffle is hit up to 12 px outside its edge).
    near: name => `(() => { const g = foldMultiples.geom(), p = foldMultiples.pointOf(${JSON.stringify(name)}); return { x: p.x, y: g.y0 - 9 }; })()`,
    blank: { x: 60, y: 76 },
    cut: `document.querySelector('.mx-now-k').textContent.startsWith('这一件')`,
    playReady: `new Promise(r => { const go = () => (foldMultiples.player.index >= 3 ? r(1) : setTimeout(go, 50)); go(); })`,
  },
  timing: {
    hook: 'foldTiming', held: 'forms/sketches/timing.html?frame=26', play: 'forms/sketches/timing.html?frame=3&mode=play',
    prepare: null, index: 'foldTiming.player.index', step: 27,
    // No concept card on this page: Tab starts from the bar's last control (the key help).
    tabFrom: '[data-lv-help]',
    // The hero question once it is registered (母亲九月住哪？ in composite), else the longest line on screen.
    pick: 'foldTiming.pick()',
    // 9 px past the end of its visible cell, on the lane's centre line (cells are hit up to 12 px past their end).
    near: name => `(() => { const g = foldTiming.geom(${JSON.stringify(name)}); return { x: g.x1 + 9, y: g.y }; })()`,
    blank: { x: 900, y: 42 },
    cut: `document.querySelector('.lv-date').textContent.startsWith('这一件') && document.querySelector('.lv-side h2').textContent.startsWith('这一件')`,
    playReady: `new Promise(r => { const go = () => (foldTiming.player.index >= 5 ? r(1) : setTimeout(go, 50)); go(); })`,
  },
  yield: {
    hook: 'foldYield', held: 'forms/sketches/yield.html?frame=23', play: 'forms/sketches/yield.html?frame=10',
    prepare: null, index: 'foldSketch.index', step: 24,
    // The outermost named block of the round (clear space past its outer end), 9 px past that end along the row.
    pick: 'foldYield.pick()',
    near: name => `foldYield.nearOf(${JSON.stringify(name)}, 9)`,
    blank: { x: 700, y: 805 }, tabFrom: '[data-y="unfold"]',
    cut: `document.querySelector('.st-title').textContent.startsWith('这一件') && document.querySelector('.st-side-kicker').textContent.includes('这一件')`,
    // Playing on (half-speed posting, 1.6 s a round) from f10: hover once a round has settled.
    playReady: `(foldYield.play(), new Promise(r => { const go = () => (foldSketch.index >= 12 && foldYield.settled() ? r(1) : setTimeout(go, 50)); go(); }))`,
  },
  // D 手机首页：触屏流程见 runHome。held 是作答与让位最重的一帧，rows 是它的下一轮（有“进行中与结果”的行可长按、左滑），
  // follow 是问题原样重登记的一帧。
  home: { hook: 'foldHome', touch: true, held: 'index.html?variant=d&frame=f22', rows: 'index.html?variant=d&frame=f23', follow: 'index.html?variant=d&frame=f26' },
  // B 时间展开：一件就是此刻 64 份柱上的一段，卡挂在柱左、盖在历史上；挑英雄数字那一件（不在就挑最大的一段）。
  // 带 ?frame= 打开不自己讲一遍；连播由本页计时（切点起 5.6 秒一轮）。
  b: {
    hook: 'foldB', held: 'index.html?variant=b&frame=26', play: 'index.html?variant=b&frame=3',
    prepare: null, index: 'foldB.index', step: 27, tabFrom: '.b-compare',
    pick: 'foldB.pick()',
    // 9 px left of the segment, level with its middle (the column is hit up to 16 px outside its left edge).
    near: name => `foldB.nearOf(${JSON.stringify(name)}, 9)`,
    blank: { x: 700, y: 22 },
    cut: `document.querySelector('#b-page-title').textContent.startsWith('这一件') && document.querySelector('.b-reader-kicker').textContent.startsWith('这一件')`,
    playReady: `new Promise(r => { foldB.play(); setTimeout(r, 1700); })`,
  },
  // C 流动形态：一滴就是一件；挑水面上最大的一滴，9 px 落在它边缘外、别的液滴碰不到的一侧（液滴命中到边缘外 12 px）。
  c: {
    hook: 'foldC', held: 'index.html?variant=c&frame=25', play: 'index.html?variant=c&frame=3',
    prepare: null, index: 'foldC.index', step: 26, tabFrom: '.c-state',
    pick: 'foldC.pick()',
    near: name => `foldC.nearOf(${JSON.stringify(name)}, 9)`,
    blank: { x: 600, y: 150 },
    cut: `document.querySelector('.c-frame-title').textContent.startsWith('这一件') && document.querySelector('.c-read-kicker').textContent.startsWith('这一件')`,
    // Play on from f03 (C's own player, 5.6 s a round from the cut); hover once the turn has crossed.
    playReady: `(foldC.play(), new Promise(r => setTimeout(r, 1700)))`,
  },
  // 原版树图：一格就是一件；详情卡盖在右栏上，旁白标题切到“这一件”。隐藏按钮紧跟在视图栏的“对比”之后。
  tree: {
    hook: 'foldTree', held: 'index.html?frame=22', play: 'index.html?frame=3',
    prepare: null, index: 'foldTree.index', step: 23, tabFrom: '#compare-button',
    // The largest tile on the board's left edge; 9 px left of the board, level with it (the band is 10 px).
    pick: 'foldTree.pick()',
    near: name => `foldTree.nearOf(${JSON.stringify(name)}, 9)`,
    blank: { x: 760, y: 768 },
    cut: `document.querySelector('#frame-title').textContent.startsWith('这一件') && Boolean(document.querySelector('.tree-card .tc-kicker')?.textContent.startsWith('这一件'))`,
    playReady: `(foldTree.play(), new Promise(r => setTimeout(r, 1700)))`,
  },
  // A 空间排布：一张纸片就是一件。held 是让位之后桌面空着 25 份的一帧（纸片四周有空桌面，9 px 外不压到别的纸）；
  // 空白点在页头（桌面满着的轮次里，桌面上没有空白处）。连播走页面自己的时钟（一轮 5.6 秒）。
  a: {
    hook: 'foldA', held: 'index.html?variant=a&frame=23', play: 'index.html?variant=a&frame=3',
    prepare: null, index: 'foldA.index', step: 24, tabFrom: '.a-breadcrumb [data-a-action="root"]',
    pick: 'foldA.pick()',
    near: name => `foldA.nearOf(${JSON.stringify(name)}, 9)`,
    blank: { x: 760, y: 34 },
    cut: `document.querySelector('.a-frame-title').textContent.startsWith('这一件') && Boolean(document.querySelector('.a-breadcrumb .a-this'))`,
    playReady: `new Promise(r => { foldA.play(); setTimeout(r, 1700); })`,
  },
  // 变形：一个圆就是一件；挑画面上最大、外侧有空地的那个圆，9 px 落在它画出的边缘外（圆命中到边缘外 10 px）。
  // 带 ?frame= 打开不自己讲一遍；连播由本页计时（换轮 0.7 秒再停 0.9 秒），悬停一件就停住。
  morph: {
    hook: 'foldMorph', held: 'forms/sketches/morph.html?frame=26', play: 'forms/sketches/morph.html?frame=3',
    prepare: null, index: 'foldSketch.index', step: 27, tabFrom: '[data-m="out"]',
    pick: 'foldMorph.pick()',
    near: name => `foldMorph.nearOf(${JSON.stringify(name)}, 9)`,
    blank: { x: 700, y: 92 },
    cut: `document.querySelector('.st-title').textContent.startsWith('这一件') && document.querySelector('.st-side-kicker').textContent.includes('这一件')`,
    playReady: `(foldMorph.play(), new Promise(r => { const go = () => (foldSketch.index >= 5 && foldMorph.settled() ? r(1) : setTimeout(go, 50)); go(); }))`,
  },
  // 峰值保持：一根表就是一件；挑看不出来的起落里的第一件（没有就挑峰值最高的一根），9 px 落在表的右边（命中区放宽到
  // 表外约 10 px）；空白点在表头上方。带 ?frame= 打开不讲一遍；连播由本页计时（1.6 秒一轮）。
  peak: {
    hook: 'foldPeak', held: 'forms/sketches/peak.html?frame=26', play: 'forms/sketches/peak.html?frame=10',
    prepare: null, index: 'foldSketch.index', step: 27, tabFrom: '[data-p="tell"]',
    pick: 'foldPeak.pick()',
    near: name => `foldPeak.nearOf(${JSON.stringify(name)}, 9)`,
    blank: { x: 900, y: 140 },
    cut: `document.querySelector('.st-title').textContent.startsWith('这一件') && document.querySelector('.st-side-kicker').textContent.includes('这一件')`,
    playReady: `(foldPeak.play(), new Promise(r => { const go = () => (foldSketch.index >= 12 && foldPeak.settled() ? r(1) : setTimeout(go, 50)); go(); }))`,
  },
  // 驻龄：一件就是方阵里它的那几格（地盘）。挑贴着方阵左边的最大一件，9 px 落在方阵左边外、与它的格平齐（命中到方阵外
  // 12 px）；空白点在页头的关系句上（方阵四周没有不属于任何一格的空处）。连播由本页计时（半速，一轮 1.6 秒）。
  age: {
    hook: 'foldAge', held: 'forms/sketches/age.html?frame=26', play: 'forms/sketches/age.html?frame=3',
    prepare: null, index: 'foldSketch.index', step: 27, tabFrom: '[data-a="tell"]',
    pick: 'foldAge.pick()',
    near: name => `foldAge.nearOf(${JSON.stringify(name)}, 9)`,
    blank: { x: 700, y: 92 },
    cut: `document.querySelector('.st-title').textContent.startsWith('这一件') && document.querySelector('.st-side-kicker').textContent.includes('这一件')`,
    playReady: `(foldAge.play(), new Promise(r => { const go = () => (foldSketch.index >= 5 && foldAge.settled() ? r(1) : setTimeout(go, 50)); go(); }))`,
  },
  // 等待链：一行（开着的问题）就是一件，等它的人各是一件；挑等的人最多的一行，指着它在脊上的结。
  // 带 ?frame= 打开不自己讲一遍；连播走页面自己的时钟（12 小时约 1 秒）。
  chain: {
    hook: 'foldChain', held: 'forms/sketches/chain.html?frame=26', play: 'forms/sketches/chain.html?frame=3&mode=play',
    prepare: null, index: 'foldChain.player.index', step: 27, tabFrom: '[data-lv-help]',
    pick: 'foldChain.pick()',
    // 9 px above the knot, on the spine: still inside the row's band, clear of every name and line.
    near: name => `(() => { const g = foldChain.geom(${JSON.stringify(name)}); return { x: g.kx, y: g.ky - g.kr - 9 }; })()`,
    blank: { x: 900, y: 42 },
    cut: `document.querySelector('.lv-date').textContent.startsWith('这一件') && document.querySelector('.lv-side h2').textContent.startsWith('这一件')`,
    playReady: `new Promise(r => { const go = () => (foldChain.player.index >= 5 ? r(1) : setTimeout(go, 50)); go(); })`,
  },
  // 01 拔河：一件是评估条上的一段（另有曲线上的一轮、一根朱红柱）；挑此刻最大的一段，9 px 外是条左边的刻度旁。
  // 空白点在章节标签与条顶之间那一溜（图里，什么都不画）。带 ?frame= 打开不自己讲一遍；连播半速，一轮 0.75 秒。
  tug: {
    hook: 'foldTug', held: 'forms/sketches/tug.html?frame=26', play: 'forms/sketches/tug.html?frame=3',
    prepare: null, index: 'foldSketch.index', step: 27, tabFrom: '[data-t="tell"]',
    pick: 'foldTug.pick()',
    near: name => `foldTug.nearOf(${JSON.stringify(name)}, 9)`,
    blank: { x: 700, y: 200 },
    cut: `document.querySelector('.st-title').textContent.startsWith('这一件') && document.querySelector('.st-side-kicker').textContent.includes('这一件')`,
    playReady: `(foldTug.play(), new Promise(r => { const go = () => (foldSketch.index >= 5 && foldTug.settled() ? r(1) : setTimeout(go, 30)); go(); }))`,
  },
  // 结绳：一根垂绳就是一件（合计绳与留白也各是一件）；挑此刻最大的根层垂绳，9 px 落在它十位一带图形的左边（命中区 10 px）。
  // 带 ?frame= 打开不自己讲一遍；Tab 从工具栏最后一个控件（换数据集的链接）开始。连播是半速，一轮约 1.1 秒。
  khipu: {
    hook: 'foldKhipu', held: 'forms/sketches/khipu.html?frame=26', play: 'forms/sketches/khipu.html?frame=10',
    prepare: null, index: 'foldSketch.index', step: 27,
    pick: 'foldKhipu.pick()',
    near: name => `foldKhipu.nearOf(${JSON.stringify(name)}, 9)`,
    blank: { x: 700, y: 820 }, tabFrom: '[data-k="data"]',
    cut: `document.querySelector('.st-title').textContent.startsWith('这一件') && document.querySelector('.st-side-kicker').textContent.includes('这一件')`,
    playReady: `(foldKhipu.play(), new Promise(r => { const go = () => (foldSketch.index >= 12 && foldKhipu.settled() ? r(1) : setTimeout(go, 50)); go(); }))`,
  },
  // E 折叠屏：触屏流程见 runDuo（桌面尺寸、CDP 触屏事件），在 D 那一套之外加铰链（把手、[ ]、F、?hinge=、三个姿态）、
  // 左页详情（右半仍可作答）、色带格联动与讲一遍。held 是作答的一帧，next 是它的下一轮，follow 是问题原样重登记的一帧。
  duo: { hook: 'foldDuo', duo: true,
    frames: { composite: { held: 'f22', next: 'f23', follow: 'f26', item: 'smilla-vet' }, story: { held: 'f04', next: 'f05', follow: 'f05', item: 'launch' } } },
  // 回应托盘：手机触屏，流程见 runTrays。held 是一轮里有一下与两下托盘的一帧（story 两周都没有两下的托盘）；
  // tell 是直接打开时讲一遍的起点与终态。
  trays: { hook: 'foldTrays', touch: true, runner: runTrays, page: 'forms/trays.html',
    held: { composite: 'f26', story: 'f20' }, tell: { composite: { from: 'f25', end: 'f26' }, story: { from: 'f19', end: 'f21' } } },
};

function args(argv) {
  const out = { base: 'http://127.0.0.1:4173', data: null, only: Object.keys(PAGES) };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, ''), value = argv[i + 1];
    if (key === 'only') out.only = value.split(','); else if (key in out) out[key] = value; else throw new Error(`未知参数 ${argv[i]}`);
  }
  return out;
}

async function launch() {
  const profile = await mkdtemp(path.join(tmpdir(), 'fold-ix-'));
  const bin = process.env.CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
  const chrome = spawn(bin, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let text = '';
    chrome.stderr.on('data', c => { text += c; const m = text.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
    setTimeout(() => reject(new Error('Chrome 没有启动调试端口')), 15000);
  });
  const socket = new WebSocket(endpoint);
  let id = 0;
  const pending = new Map(), listeners = new Set();
  socket.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
    else listeners.forEach(f => f(m));
  };
  await new Promise(r => { socket.onopen = r; });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const m = { id: ++id, method, params, ...(sessionId ? { sessionId } : {}) };
    pending.set(m.id, { resolve, reject }); socket.send(JSON.stringify(m));
  });
  const close = async () => { socket.close(); chrome.kill(); await rm(profile, { recursive: true, force: true }).catch(() => {}); };
  return { send, listeners, close };
}

async function run(cdp, base, data, name) {
  const P = PAGES[name];
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);
  const errors = [];
  cdp.listeners.add(m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  await S('Runtime.enable'); await S('Page.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ev = async expr => {
    const { result, exceptionDetails } = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  const open = async url => {
    const u = new URL(url, `${base.replace(/\/$/, '')}/`);
    if (data) u.searchParams.set('data', data);
    await S('Page.navigate', { url: u.href });
    for (let t = 0; t < 75; t += 1) { if (await ev('document.readyState') === 'complete') break; await wait(200); }
    await wait(2500);
  };
  const move = (x, y) => S('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const click = async (x, y) => {
    await S('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const KEYS = { Escape: 27, Enter: 13, Tab: 9, ArrowRight: 39 };
  const key = async k => {
    await S('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: KEYS[k] });
    if (k === 'Enter') await S('Input.dispatchKeyEvent', { type: 'char', text: '\r' });
    await S('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: KEYS[k] });
  };
  const tap = async (x, y) => { await S('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await S('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const state = async () => ({ ...(await ev(`${P.hook}.ixState()`)), cut: await ev(P.cut), index: await ev(P.index) });
  const results = [];
  const check = (label, ok, info) => results.push({ ok: Boolean(ok), label, info: JSON.stringify(info) });
  const card = s => s.peek || s.inPlace;

  await open(P.held);
  if (P.prepare) { await ev(`(${P.prepare}, 1)`); await wait(200); }
  const item = await ev(P.pick);
  const pt = await ev(`${P.hook}.pointOf(${JSON.stringify(item)})`);
  // 1–4: hover with the real pointer, its widened band, the grace and the resume.
  await move(pt.x, pt.y); await wait(450);
  let s = await state();
  check(`悬停 ${item}：概要卡出现、播放停住`, s.hover && card(s) && s.paused, s);
  const off = await ev(P.near(item));
  await move(off.x, off.y); await wait(200);
  s = await state();
  check('离开图形 9 px 仍算悬停（命中区放宽）', s.hover, { hover: s.hover, at: off });
  await move(P.blank.x, P.blank.y); await wait(250);
  s = await state();
  check('移开 0.25 秒：卡收起、播放仍停（0.15 宽限 + 0.4 恢复）', !s.hover && s.paused, s);
  await wait(600);
  s = await state();
  check('移开 0.85 秒：播放恢复', !s.paused && !s.peek, s);
  // 5–8: click to open; Esc, the same item again and a blank click fold it back.
  await move(pt.x, pt.y); await wait(300);
  await click(pt.x, pt.y); await wait(1100);
  s = await state();
  check('点击展开：详情卡展开到底、标题与面板切到这一件', s.open && s.detail && s.clip === 'none' && s.cut, s);
  await key('Escape'); await wait(700);
  s = await state();
  check('Esc 收回：卡收起、切回', !s.open && !s.detail && !s.cut, s);
  await click(pt.x, pt.y); await wait(1000);
  await click(pt.x, pt.y); await wait(700);
  s = await state();
  check('再点同一件：收回', !s.open && !s.detail, s);
  await click(pt.x, pt.y); await wait(1000);
  await click(P.blank.x, P.blank.y); await wait(700);
  s = await state();
  check('点空白：收回', !s.open && !s.detail, s);
  // 9–11: keyboard. Tab from the bar's last control lands on the first item's hidden button (a hover); Enter opens and
  // moves focus into the card; Esc folds it and puts focus back on that button.
  await move(P.blank.x, P.blank.y); await wait(800);
  await ev(`document.querySelector(${JSON.stringify(P.tabFrom || '[data-card]')}).focus(), 1`);
  await key('Tab'); await wait(400);
  s = await state();
  check('Tab 到事项：概要卡出现', s.focus === 'proxy' && s.hover && card(s), s);
  await key('Enter'); await wait(1100);
  s = await state();
  check('回车展开，焦点进卡', s.open && s.detail && s.focus === 'detail', s);
  await key('Escape'); await wait(700);
  s = await state();
  check('Esc 收回，焦点回到事项', !s.open && s.focus === 'proxy', s);
  await ev('document.activeElement.blur(), 1'); await wait(700);
  // 12–13: touch has no hover: the first tap is the hover, the second opens.
  await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await tap(pt.x, pt.y); await wait(500);
  s = await state();
  check('触屏第一下：悬停', s.hover && !s.open, s);
  await tap(pt.x, pt.y); await wait(1100);
  s = await state();
  check('触屏第二下：展开', s.open && s.detail, s);
  await tap(P.blank.x, P.blank.y); await wait(800);
  await S('Emulation.setTouchEmulationEnabled', { enabled: false });
  // 16 (before the playing page): navigation drops hover and detail at once.
  if (P.prepare) { await ev(`(${P.prepare}, 1)`); await wait(200); }
  await ev(`${P.hook}.open(${JSON.stringify(item)}), 1`); await wait(1000);
  await key('ArrowRight'); await wait(300);
  const stepped = await state();
  // 14–15: while playing on, hovering holds the round; leaving lets it go on.
  await open(P.play);
  await ev(P.playReady);
  const big = await ev(P.pick), p2 = await ev(`${P.hook}.pointOf(${JSON.stringify(big)})`);
  await move(p2.x, p2.y); await wait(300);
  const i0 = await ev(P.index);
  await wait(5000);
  s = await state();
  check('连播中悬停：5 秒不进下一轮', s.index === i0 && s.paused, { i0, ...s });
  await move(P.blank.x, P.blank.y); await wait(5200);
  s = await state();
  check('移开后接着播', s.index > i0, { i0, index: s.index });
  check('→ 换轮：立即收起', !stepped.open && !stepped.detail && stepped.index === P.step, stepped);
  await cdp.send('Target.closeTarget', { targetId });
  return { results, errors };
}

// D: a phone (390 × 844, touch). Long press is its hover; a tap answers or opens; the detail grows out of the card.
async function runHome(cdp, base, data, name) {
  const P = PAGES[name];
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);
  const errors = [];
  cdp.listeners.add(m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  await S('Runtime.enable'); await S('Page.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ev = async expr => {
    const { result, exceptionDetails } = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  const open = async url => {
    const u = new URL(url, `${base.replace(/\/$/, '')}/`);
    if (data) u.searchParams.set('data', data);
    await S('Page.navigate', { url: u.href });
    for (let t = 0; t < 75; t += 1) { if (await ev('document.readyState') === 'complete') break; await wait(200); }
    await wait(1500);
  };
  const touch = (type, x, y) => S('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const tap = async (x, y) => { await touch('touchStart', x, y); await wait(40); await touch('touchEnd'); };
  const hold = async (x, y, ms) => { await touch('touchStart', x, y); await wait(ms); await touch('touchEnd'); };
  const drag = async (x, y, dx, dy, ms = 240, steps = 12) => {
    await touch('touchStart', x, y);
    for (let i = 1; i <= steps; i += 1) { await wait(ms / steps); await touch('touchMove', x + (dx * i) / steps, y + (dy * i) / steps); }
    await touch('touchEnd');
  };
  const KEYS = { Escape: 27, Enter: 13, Tab: 9, ArrowRight: 39 };
  const key = async k => {
    await S('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: KEYS[k] });
    if (k === 'Enter') await S('Input.dispatchKeyEvent', { type: 'char', text: '\r' });
    await S('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: KEYS[k] });
  };
  const H = P.hook;
  const state = async () => ({ ...(await ev(`${H}.ixState()`)), index: await ev(`${H}.model.snapshot().index`), waiting: await ev(`${H}.waiting()`),
    dim: await ev(`document.querySelector('.d-scroll').classList.contains('is-dim')`) });
  // Centre of an element on screen, scrolled to the middle first (on a phone the page scrolls as a whole).
  const at = async selector => ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(r.width / 2, 150)), y: Math.round(r.top + Math.min(r.height / 2, 40)), id: el.dataset.id || el.closest('[data-id]')?.dataset.id || null }; })()`);
  const blank = async () => ev(`(() => { scrollTo(0, 0); const r = document.querySelector('.d-date').getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }; })()`);
  const keyed = id => `document.querySelector('[data-key="i:' + CSS.escape(${JSON.stringify(id)}) + '"]')`;
  const results = [];
  const check = (label, ok, info) => results.push({ ok: Boolean(ok), label, info: JSON.stringify(info) });
  const closed = s => !s.open && !s.detail;

  // 1: a link with ?frame= lands on that frame, as the end state: nothing plays but the one new-question outline.
  await open(P.held);
  const landing = await ev(`({ id: ${H}.model.snapshot().frame.id,
    running: document.getAnimations().filter(a => a.playState === 'running' && a.animationName !== 'd-new').length })`);
  check('带 ?frame= 进来：落在那一帧，不演开场', landing.id === 'f22' && landing.running === 0, landing);
  // 2–6: long press is the hover; a tap elsewhere folds it; moving cancels it; a tap on the summary opens the row.
  await open(P.rows);
  const row = await at('.d-line');
  await hold(row.x, row.y, 600); await wait(250);
  let s = await state();
  check(`长按 0.45 秒：${row.id} 出概要卡，其余降到七成`, s.hover === row.id && s.peek && s.dim && closed(s), s);
  let b = await blank();
  await tap(b.x, b.y); await wait(400);
  s = await state();
  check('点空白：概要卡收起，不展开', !s.peek && !s.dim && closed(s), s);
  const other = await at('.d-line');
  await touch('touchStart', other.x, other.y); await wait(120);
  for (let i = 1; i <= 4; i += 1) { await touch('touchMove', other.x, other.y - i * 5); await wait(30); }
  await wait(500); await touch('touchEnd'); await wait(300);
  s = await state();
  check('按住时移动超过 10 px：取消长按', !s.peek && !s.hover, s);
  await ev(`${H}.close()`); await wait(600);
  const again = await at('.d-line');
  await hold(again.x, again.y, 600); await wait(250);
  const peek = await ev(`(() => { const r = document.querySelector('.d-peek').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await tap(peek.x, peek.y); await wait(800);
  s = await state();
  check('长按后点概要卡：从这一行长出详情', s.open === again.id && s.detail && s.clip === 'none' && !s.peek, s);
  await key('Escape'); await wait(700);
  s = await state();
  check('Esc 收回：详情收起、亮度恢复、焦点回到这一行', closed(s) && !s.dim && s.focus === 'proxy', s);
  // 7–10: a tap on a card grows the detail (0.48 s); a short pull springs back, a long one closes it; ‹ closes it.
  await blank();
  const lead = await at('.d-card:not(.is-answered) [data-part="prompt"]');
  await tap(lead.x, lead.y); await wait(700);
  s = await state();
  check(`轻点卡：0.48 秒后详情到全屏（${lead.id}）`, s.open === lead.id && s.detail && s.clip === 'none' && s.focus === 'detail', s);
  await drag(195, 260, 0, 70, 200); await wait(450);
  s = await state();
  check('详情到顶时短下拉 70 px：弹回全屏', s.open === lead.id && s.detail && s.clip === 'none', s);
  await drag(195, 240, 0, 420, 300); await wait(700);
  s = await state();
  check('下拉超过四分之一屏：跟手收回', closed(s) && !s.dim, s);
  await tap(lead.x, lead.y); await wait(700);
  const back = await ev(`(() => { const r = document.querySelector('.d-detail [data-d="back"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tap(back.x, back.y); await wait(700);
  s = await state();
  check('点 ‹ 返回：收回', closed(s), s);
  // 11–12: swipe a row of 进行中与结果 left: past 80 px it says 知道了; short of it, it springs back.
  const line = await at('.d-line:not(.is-read)');
  await drag(line.x + 100, line.y, -50, 0, 200); await wait(400);
  const short = await ev(`(() => { const el = ${keyed(line.id)}; return { read: el.classList.contains('is-read'), t: getComputedStyle(el).transform }; })()`);
  check('左滑 50 px：回弹，不算知道了', !short.read && short.t === 'none', short);
  await drag(line.x + 100, line.y, -120, 0, 240); await wait(700);
  const swiped = await ev(`(() => { const el = ${keyed(line.id)}; return { read: !el || el.classList.contains('is-read'), status: el?.querySelector('.d-status')?.textContent }; })()`);
  s = await state();
  check('左滑过 80 px：这一行知道了，不展开', swiped.read && closed(s), { ...swiped, open: s.open });
  // 13–16: tap a button: the card folds into a receipt, the count drops; the finger guard; focus on 撤回; undo.
  await blank();
  const w0 = (await state()).waiting;
  const btn = await at('.d-card:not(.is-answered) [data-rs-act]');
  await tap(btn.x, btn.y); await wait(250);
  check('焦点落在“撤回”', await ev(`document.activeElement?.matches('[data-rs-undo]') ?? false`), await ev('document.activeElement?.outerHTML.slice(0, 80)'));
  await tap(btn.x, btn.y); await wait(1000);
  s = await state();
  const answered = await ev(`${H}.facts(${JSON.stringify(btn.id)})`);
  check('轻点按钮作答：卡收成回执、数字减一', answered.mark === 'receipt' && s.waiting === w0 - 1, { answered, w0, waiting: s.waiting });
  check('0.25 秒后再点同一处：手指保护，不落到补上来的卡', s.waiting === w0 - 1 && closed(s), s);
  const undo = await at(`[data-key="i:${btn.id}"] [data-rs-undo]`);
  await tap(undo.x, undo.y); await wait(800);
  s = await state();
  const undone = await ev(`${H}.facts(${JSON.stringify(btn.id)})`);
  check('撤回：卡回到原样、数字加一', s.waiting === w0 && undone.mark !== 'receipt' && !undone.answered, { undone, waiting: s.waiting });
  // 17–18: while playing, a long press holds the round. → folds the summary at once and goes to the next round.
  await ev(`${H}.model.togglePlay(), 1`); await wait(150);
  const i0 = (await state()).index;
  const held = await at('.d-line');
  await hold(held.x, held.y, 600);
  await wait(4000);
  s = await state();
  check('连播中长按：停住，不进下一轮', s.peek && s.paused && s.index === i0, { i0, ...s });
  await key('ArrowRight'); await wait(400);
  s = await state();
  check('→ 换轮：概要立即收起，到下一轮', !s.peek && !s.hover && s.index === i0 + 1, { i0, ...s });
  // 19–21: keyboard: Tab onto a row shows its summary; Enter opens; Esc folds and gives focus back.
  await ev(`(document.querySelector('.d-zone-head [data-ack-many]') || document.querySelector('.d-card:last-of-type')).focus(), 1`);
  await key('Tab'); await wait(400);
  s = await state();
  check('Tab 到行：概要卡出现', s.hover && s.peek && s.focus === 'proxy', s);
  await key('Enter'); await wait(800);
  s = await state();
  check('回车展开，焦点进详情', s.open && s.detail && s.focus === 'detail', s);
  await key('Escape'); await wait(700);
  s = await state();
  check('Esc 收回，焦点回到行', closed(s) && s.focus === 'proxy', s);
  // 22–23: the receipt follows the item into the next 整理: under its row once the question closed, still a receipt when
  // the same question was registered again (the count does not bounce back), “你答过上一版” on the card when it was rewritten.
  const follows = async url => {
    await open(url);
    const id = await ev(`${H}.top()`);
    await ev(`${H}.answer(${JSON.stringify(id)}), 1`); await wait(1200);
    const before = await ev(`${H}.facts(${JSON.stringify(id)})`), w = await ev(`${H}.waiting()`);
    await ev(`${H}.go(${H}.model.snapshot().index + 1), 1`); await wait(1800);
    const after = await ev(`${H}.facts(${JSON.stringify(id)})`), w1 = await ev(`${H}.waiting()`);
    const ok = !after.present || (after.ask === before.ask ? after.answered && ['receipt', 'done-row'].includes(after.mark)
      : after.ask ? after.mark === 'prior' : after.mark === 'row');
    return { ok, id, before, after, w, w1 };
  };
  const f1 = await follows(P.held);
  check('换轮后回执跟着条目走（作答那一帧 → 下一轮）', f1.ok, f1);
  const f2 = await follows(P.follow);
  check('问题原样重登记：仍是回执、不算等你回应', f2.ok, f2);
  await cdp.send('Target.closeTarget', { targetId });
  return { results, errors };
}

// E 折叠屏：桌面视口（整台按 pt 缩进来）加触屏事件。长按、轻点、色带格、左页详情、作答撤回、键盘、连播打断与 D 同一套标准；
// 另加铰链：姿态按钮、F、[ ]、拖把手松手落位、?hinge= 定格、减少动态直接到终态，以及不带帧号直接打开时讲一遍、按键跳过。
async function runDuo(cdp, base, data, name) {
  const P = PAGES[name], F = P.frames[data || 'composite'] || P.frames.composite;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);
  const errors = [];
  cdp.listeners.add(m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  await S('Runtime.enable'); await S('Page.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ev = async expr => {
    const { result, exceptionDetails } = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  const open = async (query, settle = 1500) => {
    const u = new URL(`index.html?variant=duo${query ? `&${query}` : ''}`, `${base.replace(/\/$/, '')}/`);
    if (data) u.searchParams.set('data', data);
    await S('Page.navigate', { url: u.href });
    for (let t = 0; t < 75; t += 1) { if (await ev('document.readyState') === 'complete') break; await wait(200); }
    await wait(settle);
  };
  const touch = (type, x, y) => S('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const tap = async (x, y) => { await touch('touchStart', x, y); await wait(40); await touch('touchEnd'); };
  const hold = async (x, y, ms) => { await touch('touchStart', x, y); await wait(ms); await touch('touchEnd'); };
  const drag = async (x, y, dx, dy, ms = 300, steps = 15) => {
    await touch('touchStart', x, y);
    for (let i = 1; i <= steps; i += 1) { await wait(ms / steps); await touch('touchMove', x + (dx * i) / steps, y + (dy * i) / steps); }
    await touch('touchEnd');
  };
  const KEYS = { Escape: [27, 'Escape'], Enter: [13, 'Enter'], Tab: [9, 'Tab'], ArrowRight: [39, 'ArrowRight'], '[': [219, 'BracketLeft'], ']': [221, 'BracketRight'], f: [70, 'KeyF'], x: [88, 'KeyX'] };
  const key = async k => {
    const [code, name] = KEYS[k];
    await S('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: name, windowsVirtualKeyCode: code });
    if (k === 'Enter') await S('Input.dispatchKeyEvent', { type: 'char', text: '\r' });
    await S('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: name, windowsVirtualKeyCode: code });
  };
  const H = P.hook, item = JSON.stringify(F.item);
  const state = async () => ({ ...(await ev(`${H}.ixState()`)), ...(await ev(`${H}.state()`)), index: await ev(`${H}.model.snapshot().index`),
    frame: await ev(`${H}.model.snapshot().frame.id`), waiting: await ev(`${H}.waiting()`), you: await ev(`${H}.you()`),
    dim: await ev(`document.querySelector('.u-device').classList.contains('is-dim')`) });
  const at = async (id, part) => ev(`${H}.at(${JSON.stringify(id)}, ${JSON.stringify(part)})`);
  const blank = async () => ev(`(() => { const r = document.querySelector('[data-key="h:R"] .d-date').getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }; })()`);
  const results = [];
  const check = (label, ok, info) => results.push({ ok: Boolean(ok), label, info: JSON.stringify(info) });
  const closed = s => !s.open && !s.detail;

  // 1: a link with ?frame= lands on that frame as the end state: the spread, nothing playing but the new-question outline.
  await open(`frame=${F.held}`);
  const landing = await ev(`({ id: ${H}.model.snapshot().frame.id, ...${H}.state(),
    running: document.getAnimations().filter(a => a.playState === 'running' && a.animationName !== 'd-new').length })`);
  check('带 ?frame= 进来：书本终态，不演开场', landing.id === F.held && landing.phase === 'book' && !landing.tell && landing.running === 0, landing);
  // 2–5: long press is the hover; a tap on blank folds it; moving cancels it; a run of the band outlines its stripe.
  const top = await ev(`${H}.top()`);
  let p = await at(top, 'L');
  await hold(p.x, p.y, 600); await wait(250);
  let s = await state();
  check(`长按左半 0.45 秒：${top} 出概要卡，其余降到七成`, s.hover === top && s.peek && s.dim && closed(s), s);
  let b = await blank();
  await tap(b.x, b.y); await wait(400);
  s = await state();
  check('点空白：概要卡收起，不展开', !s.peek && !s.dim && closed(s), s);
  await touch('touchStart', p.x, p.y); await wait(120);
  for (let i = 1; i <= 4; i += 1) { await touch('touchMove', p.x, p.y - i * 5); await wait(30); }
  await wait(500); await touch('touchEnd'); await wait(300);
  s = await state();
  check('按住时移动超过 10 px：取消长按', !s.peek && !s.hover, s);
  const cell = await ev(`${H}.bandPoint(${JSON.stringify(top)})`);
  await hold(cell.x, cell.y, 600); await wait(250);
  s = await state();
  const outlined = await ev(`[...document.querySelectorAll('.is-linked')].map(el => el.dataset.key)`);
  check('长按色带格：那一件的两半描框、出概要卡', s.linked === top && s.peek && outlined.includes(`L:${top}`) && outlined.includes(`R:${top}`), { ...s, outlined });
  b = await blank(); await tap(b.x, b.y); await wait(400);
  // 6–10: a tap on a left half grows the detail over the left page; the right half stays answerable; Esc / blank close it.
  p = await at(top, 'L');
  await tap(p.x, p.y); await wait(800);
  s = await state();
  for (let i = 0; i < 10 && s.clip === 'growing'; i += 1) { await wait(100); s = await state(); } // 动画 0.48 秒；机器忙时起播会晚，只看落定后的状态
  const geo = await ev(`(() => { const d = document.querySelector('.u-ldetail').getBoundingClientRect(), g = document.querySelector('.u-grip').getBoundingClientRect();
    const btn = ${H}.at(${JSON.stringify(top)}, 'button'); const hit = btn && document.elementFromPoint(btn.x, btn.y);
    return { right: Math.round(d.right), crease: Math.round(g.left + g.width / 2), answerable: Boolean(hit?.closest('[data-rs-act]')) }; })()`);
  check(`轻点左半：详情长满左页，焦点进详情（${top}）`, s.open === top && s.detail && s.clip === 'none' && s.focus === 'detail' && geo.right <= geo.crease, { ...s, ...geo });
  check('详情开着：右半的按钮仍露在外面、可以点', geo.answerable, geo);
  await key('Escape'); await wait(700);
  s = await state();
  check('Esc 收回：详情收起，焦点回到左半', closed(s) && s.focus === 'proxy', s);
  await tap(p.x, p.y); await wait(800);
  const btn = await at(top, 'button');
  await tap(btn.x, btn.y); await wait(900);
  s = await state();
  let f = await ev(`${H}.facts(${JSON.stringify(top)})`);
  check('详情开着时在右半作答：右半收成回执，详情不收', f.mark === 'receipt' && s.open === top && s.detail, { f, open: s.open });
  const u = await at(top, 'undo');
  await tap(u.x, u.y); await wait(700);
  b = await blank(); await tap(b.x, b.y); await wait(700);
  s = await state();
  check('撤回后点空白：详情收回', closed(s) && !(await ev(`${H}.facts(${JSON.stringify(top)})`)).answered, s);
  // 11–14: answer on the right half: it folds into a receipt in place, the stripe keeps its height, the shares drop;
  // focus on 撤回; a second tap where the button was does nothing; undo brings it back.
  const y0 = (await state()).you, h0 = (await ev(`${H}.facts(${JSON.stringify(top)})`)).heights;
  const share = await ev(`${H}.model.snapshot().state.root.items.find(x => x.id === ${JSON.stringify(top)}).share`);
  const b2 = await at(top, 'button');
  await tap(b2.x, b2.y); await wait(250);
  check('作答后焦点落在“撤回”', await ev(`document.activeElement?.matches('[data-rs-undo]') ?? false`), await ev('document.activeElement?.outerHTML.slice(0, 80)'));
  await tap(b2.x, b2.y); await wait(900);
  s = await state();
  f = await ev(`${H}.facts(${JSON.stringify(top)})`);
  check('轻点按钮作答：右半就地收成回执，条高不变，份数少了这一件', f.mark === 'receipt' && f.heights.R === h0.R && f.heights.L === h0.L && s.you === y0 - share, { f, h0, y0, you: s.you, share });
  check('0.25 秒后再点同一处：不展开、不再作答', closed(s) && s.you === y0 - share, s);
  const u2 = await at(top, 'undo');
  await tap(u2.x, u2.y); await wait(800);
  s = await state();
  f = await ev(`${H}.facts(${JSON.stringify(top)})`);
  check('撤回：右半回到原样，份数回来', !f.answered && f.mark !== 'receipt' && s.you === y0, { f, you: s.you });
  // 15–17: keyboard: Tab onto a left half shows its summary? (halves open on Enter) — Tab to a compact stripe or row shows the summary.
  await ev(`(document.querySelector('.u-spread > .u-mini.is-right') || document.querySelector('.u-zone .d-line')).previousElementSibling?.focus?.(), 1`);
  await ev(`(() => { const el = document.querySelector('.u-spread > .u-mini.is-left') || document.querySelector('.u-zone .d-line'); el.scrollIntoView({ block: 'center' }); const prev = [...document.querySelectorAll('.u-spread [tabindex="0"], .u-spread button')].filter(x => x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1); prev?.focus(); return 1; })()`);
  await key('Tab'); await wait(400);
  s = await state();
  check('Tab 到单行条或行：概要卡出现', s.hover && s.peek && s.focus === 'proxy', s);
  await key('Enter'); await wait(800);
  s = await state();
  check('回车展开，焦点进详情', s.open && s.detail && s.focus === 'detail', s);
  await key('Escape'); await wait(700);
  s = await state();
  check('Esc 收回，焦点回到原处', closed(s) && s.focus === 'proxy', s);
  // 18–22: the hinge. Posture buttons; F folds and unfolds; [ ] in steps of 15° (half-folded below 170°, unsettles below 110°);
  // the handle follows the finger and a release snaps to the nearest posture.
  const pick = async name2 => { const r = await ev(`(() => { const r = document.querySelector('[data-posture="${name2}"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`); await tap(r.x, r.y); await wait(900); return state(); };
  const c = await pick('closed'), bk = await pick('book'), tb = await pick('table'), bk2 = await pick('book');
  check('姿态按钮：合上是外屏“件”，书本“份”，桌面“份”', c.phase === 'closed' && /件/.test(c.hero) && bk.phase === 'book' && /份/.test(bk.hero) && tb.posture === 'table' && /份/.test(tb.hero) && bk2.posture === 'book' && bk2.phase === 'book',
    { closed: [c.phase, c.hero], book: [bk.phase, bk.hero], table: [tb.posture, tb.hero], back: bk2.phase });
  await ev('document.activeElement?.blur(), 1');
  await key('f'); await wait(900);
  const f1 = await state();
  await key('f'); await wait(1100);
  const f2 = await state();
  check('F：一键合上，再按展开', f1.phase === 'closed' && f1.angle === 0 && f2.phase === 'book' && f2.angle === 180, { f1: [f1.phase, f1.angle], f2: [f2.phase, f2.angle] });
  await key('['); await wait(300);
  const k1 = await state();
  for (let i = 0; i < 4; i += 1) { await key('['); await wait(120); }
  await wait(500);
  const k2 = await state();
  await key(']'); await key(']'); await key(']'); await key(']'); await key(']'); await wait(700);
  const k3 = await state();
  check('[ ]：每次 15°；165° 半折（两半离开折痕），105° 退出跨页，回到 180° 重新整理', k1.angle === 165 && k1.half && k1.phase === 'book' && k2.angle === 105 && k2.phase === 'reveal' && k3.angle === 180 && k3.phase === 'book' && !k3.half,
    { k1: [k1.angle, k1.phase, k1.half], k2: [k2.angle, k2.phase], k3: [k3.angle, k3.phase, k3.half] });
  await ev(`${H}.posture('closed'), 1`); await wait(900);
  const grip = async () => ev(`(() => { const r = document.querySelector('.u-grip').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const kscale = await ev(`(() => { const d = document.querySelector('.u-device'); return d.getBoundingClientRect().width / d.offsetWidth; })()`);
  let g = await grip();
  await touch('touchStart', g.x, g.y);
  for (let i = 1; i <= 10; i += 1) { await wait(30); await touch('touchMove', g.x - (i / 10) * 0.3 * 475.5 * kscale, g.y); }
  await wait(60);
  const mid = await state();
  await touch('touchEnd'); await wait(800);
  const back = await state();
  g = await grip();
  await drag(g.x, g.y, -0.62 * 475.5 * kscale, 0, 320); await wait(900);
  const opened = await state();
  check('拖把手：跟手（54°，前板跟着转到 54°），松手不到 90° 落回合上；过 90° 落到书本', mid.angle === 54 && mid.phase === 'reveal' && mid.panel === 54 && back.phase === 'closed' && back.panel === 0 && opened.phase === 'book' && opened.angle === 180 && opened.panel === 0,
    { mid: [mid.angle, mid.phase, mid.panel], back: [back.phase, back.panel], opened: [opened.phase, opened.angle, opened.panel] });
  // 23–24: while playing, a long press holds the round; → folds the summary at once and goes to the next round.
  await open(`frame=${F.held}`);
  await ev(`${H}.model.togglePlay(), 1`); await wait(150);
  const i0 = (await state()).index;
  p = await at(await ev(`${H}.top()`), 'L');
  await hold(p.x, p.y, 600);
  await wait(4000);
  s = await state();
  check('连播中长按：停住，不进下一轮', s.peek && s.paused && s.index === i0, { i0, ...s });
  await key('ArrowRight'); await wait(400);
  s = await state();
  check('→ 换轮：概要立即收起，到下一轮', !s.peek && !s.hover && s.index === i0 + 1, { i0, ...s });
  // 25–26: the receipt follows the item into the next 整理, over the fold: a row of 在办 once the question closed, still a
  // receipt when the same question was registered again, “你答过上一版” on the right half when it was rewritten.
  const follows = async frame => {
    await open(`frame=${frame}`);
    const id = await ev(`${H}.top()`);
    await ev(`${H}.answer(${JSON.stringify(id)}), 1`); await wait(1000);
    const before = await ev(`${H}.facts(${JSON.stringify(id)})`), w = await ev(`${H}.waiting()`);
    await ev(`${H}.go(${H}.model.snapshot().index + 1), 1`); await wait(1800);
    const after = await ev(`${H}.facts(${JSON.stringify(id)})`), w1 = await ev(`${H}.waiting()`);
    const ok = !after.present || (after.ask === before.ask ? after.answered && ['receipt', 'done-row'].includes(after.mark)
      : after.ask ? after.mark === 'prior' : after.mark === 'row' && after.place === 'row');
    return { ok, id, before, after, w, w1 };
  };
  const r1 = await follows(F.held);
  check('换轮后回执跟着条目走、过折痕（作答那一帧 → 下一轮）', r1.ok, r1);
  const r2 = await follows(F.follow);
  check('再换一轮：回执仍跟着条目走', r2.ok, r2);
  // 27–28: ?hinge= holds the fold at 180° × hinge. The panel turns about the crease by exactly the hinge's angle (read back
  // from its computed transform) and the right page is still the outer screen; the left page clears with the angle: at
  // 108° more of it is blurred (more blurred copies show, the sharp part by the crease is narrower) and the veil is darker
  // than at 144°, and lying flat (180°) the panel is down.
  const panelDom = `(() => { const f = document.querySelector('.u-fold3d'), m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.u-panel')).transform);
    const veil = document.querySelector('.u-veil'), layers = [...document.querySelectorAll('.u-face.is-back .u-mask')];
    return { up: f.classList.contains('is-up') && getComputedStyle(f).visibility === 'visible', turn: Math.round(Math.atan2(m.m13, m.m11) * 1800 / Math.PI) / 10,
      veil: veil ? +getComputedStyle(veil).opacity : null, blurred: layers.filter(l => +getComputedStyle(l).opacity > 0).length,
      edge: layers.length ? Math.round(new DOMMatrixReadOnly(getComputedStyle(layers[0]).transform).m41) : null }; })()`;
  await open(`frame=${F.held}&hinge=0.4`);
  s = await state();
  const outerOn = await ev(`!document.querySelector('.u-outer').classList.contains('is-off')`), d4 = await ev(panelDom);
  check('?hinge=0.4：定格在 72°，前板绕折痕转的角度与铰链一致，右页仍是外屏', s.phase === 'reveal' && s.angle === 72 && s.panel === 72 && d4.up && Math.abs(d4.turn - 72) < 0.6 && outerOn && /件/.test(s.hero), { ...s, outerOn, d4 });
  await open(`frame=${F.held}&hinge=0.6`);
  const s6 = await state(), d6 = await ev(panelDom);
  await open(`frame=${F.held}&hinge=0.8`);
  const s8 = await state(), d8 = await ev(panelDom);
  await open(`frame=${F.held}&hinge=1`);
  const d10 = await ev(panelDom), s10 = await state();
  check('左页随角度变清变亮：108° 比 144° 更糊（模糊副本更多、清楚的一段更窄）、更暗，180° 平放时前板收起',
    d6.up && d8.up && Math.abs(d6.turn - 108) < 0.6 && Math.abs(d8.turn - 144) < 0.6 && d6.blurred > d8.blurred && d6.edge > d8.edge && d6.veil > d8.veil
      && s6.fold.blur > s8.fold.blur && s6.fold.veil > s8.fold.veil && !d10.up && s10.panel === 0 && s10.phase === 'book',
    { d6, d8, d10, f6: s6.fold, f8: s8.fold });
  // 29: reduced motion: fold and unfold go straight to their end states, nothing animates.
  await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await open(`frame=${F.held}`);
  await ev(`${H}.posture('closed'), 1`); await wait(60);
  const rc = await state(), ra = await ev(`document.getAnimations().length`);
  await ev(`${H}.posture('book'), 1`); await wait(60);
  const rb = await state(), rb2 = await ev(`document.getAnimations().length`);
  check('减少动态：合上与展开直接到终态，不动画', rc.phase === 'closed' && rb.phase === 'book' && ra === 0 && rb2 === 0, { rc: rc.phase, rb: rb.phase, ra, rb2 });
  await S('Emulation.setEmulatedMedia', { features: [] });
  // 30: opened by itself (no frame, no referrer): the tell plays once; any key jumps to its end (closed, next round, answered).
  await open('', 1400);
  const telling = await state();
  await key('x'); await wait(700);
  const told = await state();
  const sample = await ev(`${H}.facts(${item})`);
  check('直接打开：讲一遍（合上 → 展开 → 答一件 → 下一轮落地 → 合上），任意键跳到结尾', telling.tell && !told.tell && told.told && told.phase === 'closed' && told.frame === F.next && sample.mark === 'row',
    { telling: [telling.tell, telling.phase, telling.frame], told: [told.tell, told.phase, told.frame], sample });
  await cdp.send('Target.closeTarget', { targetId });
  return { results, errors };
}

// 回应托盘（trays）：与 D 同一组触屏规则（长按代替悬停、轻点长出详情、下拉收回、Tab / Enter / Esc、连播中长按停住、
// 手指保护、撤回、回执跟着条目走、左滑知道了），加上它自己的：托盘高 = 头部 + 剩下几下 × 一排、数字 = 各托盘几下之和、
// 两下的托盘一下矮一排（× 退回）、直接打开先讲一遍（轻点跳过到终态）、减弱动态时不讲。story 没有两下的托盘，那几项只核对“没有”。
async function runTrays(cdp, base, data, name) {
  const P = PAGES[name], held = P.held[data === 'story' ? 'story' : 'composite'], tell = P.tell[data === 'story' ? 'story' : 'composite'];
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);
  const errors = [];
  cdp.listeners.add(m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  await S('Runtime.enable'); await S('Page.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ev = async expr => {
    const { result, exceptionDetails } = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  const open = async (query, settle = 1500) => {
    const u = new URL(`${P.page}${query ? `?${query}` : ''}`, `${base.replace(/\/$/, '')}/`);
    if (data) u.searchParams.set('data', data);
    await S('Page.navigate', { url: u.href });
    for (let t = 0; t < 75; t += 1) { if (await ev('document.readyState') === 'complete' && await ev('Boolean(window.foldTrays)')) break; await wait(200); }
    await wait(settle);
  };
  const touch = (type, x, y) => S('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const tap = async (x, y) => { await touch('touchStart', x, y); await wait(40); await touch('touchEnd'); };
  const hold = async (x, y, ms) => { await touch('touchStart', x, y); await wait(ms); await touch('touchEnd'); };
  const drag = async (x, y, dx, dy, ms = 240, steps = 12) => {
    await touch('touchStart', x, y);
    for (let i = 1; i <= steps; i += 1) { await wait(ms / steps); await touch('touchMove', x + (dx * i) / steps, y + (dy * i) / steps); }
    await touch('touchEnd');
  };
  const KEYS = { Escape: 27, Enter: 13, Tab: 9, ArrowRight: 39 };
  const key = async k => {
    await S('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: KEYS[k] });
    if (k === 'Enter') await S('Input.dispatchKeyEvent', { type: 'char', text: '\r' });
    await S('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: KEYS[k] });
  };
  const H = P.hook;
  const state = async () => ({ ...(await ev(`${H}.ixState()`)), index: await ev(`${H}.model.snapshot().index`), frame: await ev(`${H}.model.snapshot().frame.id`),
    taps: await ev(`${H}.taps()`), waiting: await ev(`${H}.waiting()`), dim: await ev(`document.querySelector('.tr-scroll').classList.contains('is-dim')`) });
  // Centre of an element (its first 150 × 40 px), scrolled to the middle of the column first.
  const at = async selector => ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(r.width / 2, 150)), y: Math.round(r.top + Math.min(r.height / 2, 20)), id: el.closest('[data-id]')?.dataset.id || null }; })()`);
  const blank = async () => ev(`(() => { document.querySelector('.tr-scroll').scrollTop = 0; const r = document.querySelector('.tr-kick').getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }; })()`);
  const tray = id => `[data-key="i:${id}"]`;
  const running = `document.getAnimations().filter(a => a.playState === 'running' && a.animationName !== 'tr-new').length`;
  const results = [];
  const check = (label, ok, info) => results.push({ ok: Boolean(ok), label, info: JSON.stringify(info) });
  const closed = s => !s.open && !s.detail;

  // 1–2: a link with ?frame= lands on that frame and stays still; every tray's height says how many taps are left.
  await open(`frame=${held}`);
  const landing = await ev(`({ id: ${H}.model.snapshot().frame.id, telling: ${H}.telling(), running: ${running} })`);
  check('带 ?frame= 进来：落在那一帧，不讲一遍、不动', landing.id === held && !landing.telling && landing.running === 0, landing);
  const law = await ev(`(() => { const t = ${H}.trays().filter(x => !x.answered), bases = t.map(x => x.height - x.rows * 46);
    return { rows: t.map(x => x.rows), heights: t.map(x => x.height), spread: Math.max(...bases) - Math.min(...bases), taps: ${H}.taps(), sum: t.reduce((n, x) => n + x.rows, 0),
      hero: Number(document.querySelector('.tr-n').textContent) }; })()`);
  check(`高度就是几下：托盘高 = 头部 + 剩下几下 × 46 px，大数字 ${law.taps} = 各托盘几下之和`, law.spread <= 2 && law.taps === law.sum && law.hero === law.taps, law);
  // 3–7: long press is the hover; a tap elsewhere folds it; moving cancels it; a tap on the summary opens the tray; Esc.
  const first = await at('.tr-tray:not(.is-receipt) .tr-meta');
  await hold(first.x, first.y, 600); await wait(250);
  let s = await state();
  check(`长按 0.45 秒：${first.id} 出概要卡，其余降到七成`, s.hover === first.id && s.peek && s.dim && closed(s), s);
  let b = await blank();
  await tap(b.x, b.y); await wait(400);
  s = await state();
  check('点空白：概要卡收起，不展开', !s.peek && !s.dim && closed(s), s);
  const moved = await at('.tr-tray:not(.is-receipt) .tr-meta');
  await touch('touchStart', moved.x, moved.y); await wait(120);
  for (let i = 1; i <= 4; i += 1) { await touch('touchMove', moved.x, moved.y - i * 5); await wait(30); }
  await wait(500); await touch('touchEnd'); await wait(300);
  s = await state();
  check('按住时移动超过 10 px：取消长按', !s.peek && !s.hover, s);
  const again = await at('.tr-tray:not(.is-receipt) .tr-meta');
  await hold(again.x, again.y, 600); await wait(250);
  const peek = await ev(`(() => { const r = document.querySelector('.tr-peek').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 16) }; })()`);
  await tap(peek.x, peek.y); await wait(800);
  s = await state();
  check('长按后点概要卡：从这个托盘长出详情', s.open === again.id && s.detail && s.clip === 'none' && !s.peek, s);
  await key('Escape'); await wait(700);
  s = await state();
  check('Esc 收回：详情收起、亮度恢复、焦点回到托盘', closed(s) && !s.dim && s.focus === 'proxy', s);
  // 8–11: a tap on a tray (not a button) grows the detail; a short pull springs back, a long one closes it; ‹ closes it.
  await blank();
  const lead = await at('.tr-tray:not(.is-receipt) .tr-title');
  await tap(lead.x, lead.y); await wait(700);
  s = await state();
  check(`轻点托盘：0.48 秒后详情到整屏（${lead.id}）`, s.open === lead.id && s.detail && s.clip === 'none' && s.focus === 'detail', s);
  await drag(195, 260, 0, 70, 200); await wait(450);
  s = await state();
  check('详情到顶时短下拉 70 px：弹回整屏', s.open === lead.id && s.detail && s.clip === 'none', s);
  await drag(195, 240, 0, 420, 300); await wait(700);
  s = await state();
  check('下拉超过四分之一屏：跟手收回', closed(s) && !s.dim, s);
  await tap(lead.x, lead.y); await wait(700);
  const back = await ev(`(() => { const r = document.querySelector('.tr-detail [data-t="back"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tap(back.x, back.y); await wait(700);
  s = await state();
  check('点 ‹ 返回：收回', closed(s), s);
  // 12–15: tap a one-tap button: the tray folds into a one-line receipt in place, the number drops by one; the finger
  // guard; focus on 撤回; undo.
  await blank();
  const s0 = await state();
  const one = await ev(`${H}.top()`);
  const btn = await at(`${tray(one)} :is([data-rs-act], [data-rs-pick])`);
  await tap(btn.x, btn.y); await wait(250);
  check('焦点落在“撤回”', await ev(`document.activeElement?.matches('[data-rs-undo]') ?? false`), await ev('document.activeElement?.outerHTML.slice(0, 80)'));
  await tap(btn.x, btn.y); await wait(1000);
  s = await state();
  const folded = await ev(`${H}.facts(${JSON.stringify(one)})`);
  check('轻点按钮作答：托盘原地收成一行回执，数字减一', folded.mark === 'receipt' && folded.height <= 48 && s.taps === s0.taps - 1 && s.waiting === s0.waiting - 1, { folded, taps: [s0.taps, s.taps] });
  check('0.25 秒后再点同一处：手指保护，不落到补上来的托盘', s.taps === s0.taps - 1 && closed(s), s);
  const undo = await at(`${tray(one)} [data-rs-undo]`);
  await tap(undo.x, undo.y); await wait(800);
  s = await state();
  const undone = await ev(`${H}.facts(${JSON.stringify(one)})`);
  check('撤回：托盘回到原样，数字加回', s.taps === s0.taps && undone.mark !== 'receipt' && !undone.answered, { undone, taps: s.taps });
  // 16–18: a two-step tray loses one row a tap: 推到… merges into the title and the dates rise (−1); × takes it back;
  // the second tap folds it into a receipt (−2 in all).
  const two = await ev(`${H}.two()`);
  if (two) {
    const h0 = (await ev(`${H}.facts(${JSON.stringify(two)})`)).height;
    const step = await at(`${tray(two)} [data-t-step]`);
    await tap(step.x, step.y); await wait(700);
    s = await state();
    const stepped = await ev(`${H}.facts(${JSON.stringify(two)})`);
    check(`两下的第一下：托盘矮一排（${h0} → ${stepped.height}），数字减一`, stepped.mark === 'stepped' && Math.abs(h0 - stepped.height - 46) <= 2 && s.taps === s0.taps - 1, { stepped, h0, taps: s.taps });
    const x = await at(`${tray(two)} [data-t-unstep]`);
    await tap(x.x, x.y); await wait(600);
    s = await state();
    const unstepped = await ev(`${H}.facts(${JSON.stringify(two)})`);
    check('点小签上的 ×：退回两排，数字加回', unstepped.mark === 'tray' && Math.abs(unstepped.height - h0) <= 1 && s.taps === s0.taps, { unstepped, taps: s.taps });
    const step2 = await at(`${tray(two)} [data-t-step]`);
    await tap(step2.x, step2.y); await wait(1300);
    const day = await at(`${tray(two)} [data-t-pick]`);
    await tap(day.x, day.y); await wait(1000);
    s = await state();
    const done = await ev(`${H}.facts(${JSON.stringify(two)})`);
    check('第二下挑一天：收成回执，两下一共减二', done.mark === 'receipt' && s.taps === s0.taps - 2, { done, taps: [s0.taps, s.taps] });
    await ev(`${H}.undo(${JSON.stringify(two)}), 1`); await wait(600);
  } else {
    const flat = await ev(`${H}.trays().every(x => x.rows <= 1)`);
    check('这一帧没有两下的托盘：每个托盘一排，几下等于几个', flat && s0.taps === s0.waiting, { taps: s0.taps, waiting: s0.waiting });
  }
  // 19–20: while playing, a long press holds the round; → folds the summary at once and goes to the next round.
  await ev(`${H}.play(), 1`); await wait(150);
  const i0 = (await state()).index;
  const heldRow = await at('.tr-tray:not(.is-receipt) .tr-meta');
  await hold(heldRow.x, heldRow.y, 600);
  await wait(6000);
  s = await state();
  check('连播中长按：停住，不进下一轮', s.peek && s.paused && s.index === i0, { i0, ...s });
  await key('ArrowRight'); await wait(400);
  s = await state();
  check('→ 换轮：概要立即收起，到下一轮', !s.peek && !s.hover && s.index === i0 + 1, { i0, ...s });
  // 21–23: keyboard: Tab onto a tray shows its summary; Enter opens; Esc folds and gives focus back.
  await open(`frame=${held}`, 900);
  await ev(`document.querySelector('.tr-hero').focus(), 1`);
  await key('Tab'); await wait(400);
  s = await state();
  check('Tab 到托盘：概要卡出现', s.hover && s.hover !== 'hero' && s.peek && s.focus === 'proxy', s);
  await key('Enter'); await wait(800);
  s = await state();
  check('回车展开，焦点进详情', s.open && s.detail && s.focus === 'detail', s);
  await key('Escape'); await wait(700);
  s = await state();
  check('Esc 收回，焦点回到托盘', closed(s) && s.focus === 'proxy', s);
  // 24–26: the receipt follows the item into the next 整理 (into 已收到与关上 once read; “答过上一版” when the question
  // was rewritten), the number does not bounce back; a short left swipe there springs back, past 80 px it says 知道了.
  await blank();
  const id = await ev(`${H}.top()`);
  await ev(`${H}.answer(${JSON.stringify(id)}), 1`); await wait(1200);
  const before = await ev(`${H}.facts(${JSON.stringify(id)})`), w0 = await ev(`${H}.waiting()`);
  await ev(`${H}.go(${H}.model.snapshot().index + 1), 1`); await wait(1800);
  const after = await ev(`${H}.facts(${JSON.stringify(id)})`), w1 = await ev(`${H}.waiting()`);
  const follows = !after.present || (after.ask ? after.mark === 'prior' : after.mark === 'ledger' && after.answered);
  check('换轮后回执跟着条目走：读到后落到“已收到与关上”', follows && before.mark === 'receipt', { id, before, after, w0, w1 });
  const line = await at(`.tr-ledger ${tray(id)}`);
  if (line) {
    await drag(line.x + 100, line.y, -50, 0, 200); await wait(400);
    const short = await ev(`(() => { const el = document.querySelector('.tr-ledger ${tray(id)}'); return { present: Boolean(el), t: el && getComputedStyle(el).transform }; })()`);
    check('左滑 50 px：回弹，不算知道了', short.present && short.t === 'none', short);
    await drag(line.x + 100, line.y, -120, 0, 240); await wait(700);
    const gone = await ev(`!${H}.ledger().some(l => l.id === ${JSON.stringify(id)})`);
    s = await state();
    check('左滑过 80 px：这一行知道了，不展开', gone && closed(s), { gone, open: s.open });
  } else check('回执所在的一行在“已收到与关上”里', false, { id, after });
  // 27–28: opened directly (top window, no ?frame=, no referrer) it tells the three beats once; a tap skips to the end.
  await open('', 400);
  const told = await ev(`({ telling: ${H}.telling(), id: ${H}.model.snapshot().frame.id })`);
  await wait(1500);
  b = await blank();
  await tap(b.x, b.y); await wait(500);
  const skipped = await ev(`({ telling: ${H}.telling(), id: ${H}.model.snapshot().frame.id, running: ${running}, open: ${H}.ixState().open })`);
  check(`直接打开：讲一遍（从 ${tell.from} 起）`, told.telling && told.id === tell.from, told);
  check(`讲一遍中轻点：跳到终态 ${tell.end}，不留动画、不展开`, !skipped.telling && skipped.id === tell.end && skipped.running === 0 && !skipped.open, skipped);
  // 29: with reduced motion it does not tell.
  await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await open('', 600);
  const calm = await ev(`({ telling: ${H}.telling(), running: ${running} })`);
  check('减弱动态：直接打开也不讲、不动', !calm.telling && calm.running === 0, calm);
  await S('Emulation.setEmulatedMedia', { features: [] });
  await cdp.send('Target.closeTarget', { targetId });
  return { results, errors };
}

const options = args(process.argv.slice(2));
const cdp = await launch();
let failed = 0;
try {
  for (const name of options.only) {
    if (!PAGES[name]) throw new Error(`未知页面 ${name}；可选：${Object.keys(PAGES).join(', ')}`);
    const { results, errors } = await (PAGES[name].runner || (PAGES[name].touch ? runHome : PAGES[name].duo ? runDuo : run))(cdp, options.base, options.data, name);
    const bad = results.filter(r => !r.ok).length + errors.length;
    failed += bad;
    console.log(`${bad ? '✗' : '✓'} ${name}${options.data ? ` · ${options.data}` : ''}：${results.filter(r => r.ok).length} / ${results.length} 项通过`);
    for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}${r.ok ? '' : ` — ${r.info}`}`);
    for (const e of errors) console.log(`  报错：${e}`);
  }
} finally {
  await cdp.close();
}
if (failed) process.exitCode = 1;
