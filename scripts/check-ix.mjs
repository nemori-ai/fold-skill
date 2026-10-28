// 交互检查：用真的输入事件（CDP 鼠标、键盘、触屏）逐项走一遍共用交互模块（prototype/forms/motion/ix.mjs）的标准：
// 悬停出概要卡并停住播放、命中区放宽、移开后宽限与恢复、点击展开并切到“这一件”、Esc / 再点 / 点空白收回、
// Tab + Enter 展开且焦点进卡、Esc 后焦点回到事项、触屏两下、连播中悬停不进下一轮、移开后接着播、→ 立即收起。
// 共 16 项，每个接入 ix.mjs 的页面都跑同一套；各页只在 PAGES 里写自己的地址、挑哪一件、怎样算“切到这一件”。
// D 手机首页（home）没有悬停，另走一套触屏流程（runHome，iPhone 尺寸、CDP 触屏事件）：长按代替悬停、轻点从卡长出详情、
// 下拉收回、左滑知道了、作答与撤回、手指保护、换轮时回执跟着条目走，以及键盘与连播的同一组打断规则。
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

const options = args(process.argv.slice(2));
const cdp = await launch();
let failed = 0;
try {
  for (const name of options.only) {
    if (!PAGES[name]) throw new Error(`未知页面 ${name}；可选：${Object.keys(PAGES).join(', ')}`);
    const { results, errors } = await (PAGES[name].touch ? runHome : run)(cdp, options.base, options.data, name);
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
