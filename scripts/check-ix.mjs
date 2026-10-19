// 交互检查：用真的输入事件（CDP 鼠标、键盘、触屏）逐项走一遍共用交互模块（prototype/forms/motion/ix.mjs）的标准：
// 悬停出概要卡并停住播放、命中区放宽、移开后宽限与恢复、点击展开并切到“这一件”、Esc / 再点 / 点空白收回、
// Tab + Enter 展开且焦点进卡、Esc 后焦点回到事项、触屏两下、连播中悬停不进下一轮、移开后接着播、→ 立即收起。
// 共 16 项，每个接入 ix.mjs 的页面都跑同一套；各页只在 PAGES 里写自己的地址、挑哪一件、怎样算“切到这一件”。
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
// “这一件”, and how to read the round on screen.
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
  await ev(`document.querySelector('[data-card]').focus(), 1`);
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

const options = args(process.argv.slice(2));
const cdp = await launch();
let failed = 0;
try {
  for (const name of options.only) {
    if (!PAGES[name]) throw new Error(`未知页面 ${name}；可选：${Object.keys(PAGES).join(', ')}`);
    const { results, errors } = await run(cdp, options.base, options.data, name);
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
