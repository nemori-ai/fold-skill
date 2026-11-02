// 入口页的自动检查：用本机无头 Chrome 打开构建好的站点首页，逐项核对（规格见 site/landing/spec.md「验收」）：
// 1. 页面上每个带 data-k 的数都等于 site/landing/data.json 里那个出处（gallery.count 等于原型总数减六）；
// 2. 七个尺寸（375×667、390×844、430×932、820×1180、1180×820、1440×900、1920×1080）从头滚到底：没有报错、没有失败的请求、
//    没有横向滚动；
// 3. 减弱动态时首屏直接是终态：与正常播放结束后的样子逐项相同，且没有动画在跑；
// 4. 画廊块数等于原型总数减六，Top 6 不在其中，其余一个不少；
// 5. 三拍按阅读线切换（1 → 2 → 3 → 回流），演示卡的按钮真的作答、撤回；首屏与第 2 拍演完后尺上没有残留的点；
// 6. 导航“全部原型”的画册面板与查看弹框照常可用；
// 7. 首屏标题的字都在字体子集里，六张卡与画廊的录像文件都在。
//
//   npm run site:build && node scripts/check-landing.mjs            # 自己起服务读 dist/
//   node scripts/check-landing.mjs --base http://127.0.0.1:4174      # 或检查已在跑的站点
//   node scripts/check-landing.mjs --shots .local/landing-shots       # 顺带存七个尺寸的首屏与整页截图
//
// 只用 Node 22 内置的 WebSocket 驱动本机 Chrome（CHROME 可指定路径），不装依赖。任一项不过时退出码为 1。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prototypes } from '../site/.vitepress/theme/prototypes.mjs';
import { TOP, galleryOf } from '../site/.vitepress/theme/landing.mjs';
import { serve } from './serve-static.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const shots = option('--shots') && path.resolve(root, option('--shots'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const SIZES = [[375, 667], [390, 844], [430, 932], [820, 1180], [1180, 820], [1440, 900], [1920, 1080]];
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let server = null;
if (!option('--base')) {
  if (!existsSync(path.join(root, 'dist/index.html'))) { console.error('dist/ 还没有构建：先运行 npm run site:build，或用 --base 指向在跑的站点。'); process.exit(1); }
  server = await serve(path.join(root, 'dist'));
}
const base = (option('--base') || server.url).replace(/\/$/, '');
const data = JSON.parse(await readFile(path.join(root, 'site/landing/data.json'), 'utf8'));

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || detail === undefined ? '' : `\n    ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

// A data-k path walks data.json, stepping into `.value` where a field keeps its number with its source.
function resolve(key) {
  if (key === 'gallery.count') return prototypes.length - TOP.length;
  let at = data;
  for (const part of key.split('.')) {
    if (at && typeof at === 'object' && part in at) at = at[part];
    else if (at && typeof at === 'object' && at.value != null && (part in Object(at.value))) at = at.value[part];
    else return undefined;
  }
  return at && typeof at === 'object' && 'value' in at ? at.value : at;
}

// ---------- Chrome ----------
const profile = await mkdtemp(path.join(tmpdir(), 'fold-landing-'));
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
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
const pending = new Map(), listeners = new Set();
socket.onmessage = event => {
  const m = JSON.parse(event.data);
  if (m.id && pending.has(m.id)) { const { done, fail } = pending.get(m.id); pending.delete(m.id); m.error ? fail(new Error(m.error.message)) : done(m.result); }
  else for (const fn of listeners) fn(m);
};
const send = (method, params = {}, sessionId) => new Promise((done, fail) => { const m = { id: ++nextId, method, params, ...(sessionId ? { sessionId } : {}) }; pending.set(m.id, { done, fail }); socket.send(JSON.stringify(m)); });

async function open([width, height], { reduced = false } = {}) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  const problems = [];
  const listen = m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') problems.push(`异常：${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`console.error：${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
    // A prototype page opened from the landing has no icon link, so the browser asks for /favicon.ico: not the landing's.
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400 && !m.params.response.url.endsWith('/favicon.ico')) problems.push(`${m.params.response.status} ${m.params.response.url.replace(base, '')}`);
    if (m.method === 'Network.loadingFailed' && !m.params.canceled && m.params.errorText !== 'net::ERR_ABORTED') problems.push(`请求失败 ${m.params.errorText}`);
  };
  listeners.add(listen);
  const mobile = width <= 1180; // phones and both iPad orientations are touch devices
  await s('Runtime.enable'); await s('Page.enable'); await s('Network.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width < 960 ? 2 : 1, mobile });
  if (mobile) {
    await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await s('Emulation.setUserAgentOverride', { userAgent: width < 700 ? IPHONE : IPAD });
  }
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  const evaluate = async expression => {
    const { result, exceptionDetails } = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  await s('Page.navigate', { url: `${base}/` });
  for (let i = 0; i < 100; i += 1) { if (await evaluate('document.readyState') === 'complete') break; await wait(100); }
  await evaluate('document.fonts.ready.then(() => 1)');
  return {
    problems, evaluate, width, height,
    async shot(file, full = false) {
      let clip;
      // Chrome repeats the page past 16 384 device pixels in one capture, so tall pages are captured scaled down.
      if (full) { const { cssContentSize: c } = await s('Page.getLayoutMetrics'); const dpr = width < 960 ? 2 : 1; clip = { x: 0, y: 0, width: Math.ceil(c.width), height: Math.ceil(c.height), scale: Math.min(1, 16000 / (Math.ceil(c.height) * dpr)) }; }
      const { data: png } = await s('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
      await writeFile(file, Buffer.from(png, 'base64'));
    },
    async key(key) { for (const type of ['keyDown', 'keyUp']) await s('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 0 }); },
    async close() { listeners.delete(listen); await send('Target.closeTarget', { targetId }); },
  };
}

// The first screen's computed end state: the playhead's window, the tick groups, segments, colours, dots, the
// caption over the ruler, the legend.
// Transforms are compared as rounded matrices: an animation that ends on \`none\` computes as the identity matrix.
const heroState = `(() => { const q = s => [...document.querySelectorAll('.fl-hero ' + s)];
  const t = e => { const v = getComputedStyle(e).transform, m = new DOMMatrixReadOnly(v === 'none' ? undefined : v); return [m.a, m.b, m.c, m.d, m.e, m.f].map(x => (Math.abs(x) < 0.005 ? 0 : x).toFixed(2)).join(','); };
  const o = e => Number(getComputedStyle(e).opacity).toFixed(2);
  return { sweep: [...q('.fl-sweep'), ...q('.fl-sweep-in')].map(t).join('|'), ticks: q('.fl-lane .g').map(e => t(e) + '/' + o(e)).join('|'), segs: q('.sg').map(t).join('|'),
    colours: q('.sg .v').map(o).join('|'), dots: q('.dt').map(e => { const m = new DOMMatrixReadOnly(getComputedStyle(e).transform === 'none' ? undefined : getComputedStyle(e).transform); return Number(o(e)) > 0.05 && Math.abs(m.a) > 0.05 ? 'seen' : 'gone'; }).join('|'), caption: q('.fl-cap span').map(o).join('|'),
    count: q('.fl-tag .rs').map(t).join('|'), legend: q('.fl-legend > span').map(o).join('|') }; })()`;
// Dots still to be seen on a stage (once absorbed they are at scale 0 or transparent): none may be left lying on the ruler.
const dotsLeft = scope => `[...document.querySelectorAll('${scope} .dt')].filter(e => { const cs = getComputedStyle(e), m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform);
  return Number(cs.opacity) > 0.05 && Math.abs(m.a) > 0.05 && Math.abs(m.d) > 0.05; }).length`;

try {
  // ---- 1. numbers, 4. gallery, 7. fonts and media (at a phone size) ----
  const page = await open([390, 844]);
  await wait(500);
  const shown = await page.evaluate(`[...document.querySelectorAll('.fl [data-k]')].map(e => ({ k: e.dataset.k, text: e.textContent.trim() }))`);
  const wrong = shown.filter(({ k, text }) => String(resolve(k)) !== text);
  check(`页面上 ${shown.length} 处数字（${new Set(shown.map(x => x.k)).size} 个出处）都等于 data.json`, shown.length > 30 && !wrong.length, wrong.map(w => `${w.k}: 页面 ${w.text} ≠ 数据 ${resolve(w.k)}`).join('；'));
  const expected = galleryOf(prototypes).map(p => p.id);
  const tiles = await page.evaluate(`[...document.querySelectorAll('.fl-tile[data-id]')].map(e => e.dataset.id)`);
  const heading = await page.evaluate(`document.querySelector('#fl-gal-title').textContent`);
  check(`画廊 ${tiles.length} 块 = 原型 ${prototypes.length} 个 − 6，标题也写 ${prototypes.length - 6}`, tiles.length === prototypes.length - 6 && heading.includes(String(prototypes.length - 6))
    && [...tiles].sort().join() === [...expected].sort().join() && !TOP.some(t => tiles.includes(t.id)), { tiles: tiles.length, heading, missing: expected.filter(id => !tiles.includes(id)) });
  const cards = await page.evaluate(`[...document.querySelectorAll('.fl-form')].map(e => e.id.replace('form-', ''))`);
  check(`六张卡按定下的顺序：${TOP.map(t => t.id).join(' → ')}`, cards.join() === TOP.map(t => t.id).join(), cards);
  const glyphs = await page.evaluate(`[...document.querySelectorAll('.fl-glyph')].map(e => e.getAttribute('href').replace('#form-', ''))`);
  check('桥的六个小图与六张卡同序', glyphs.join() === cards.join(), glyphs);
  const headings = await page.evaluate(`[...document.querySelectorAll('.fl .fl-h, .fl-form .hd h3')].map(e => e.textContent).join('')`);
  const subset = JSON.parse(await readFile(path.join(root, 'site/fonts/subset.json'), 'utf8'));
  const uncovered = [...new Set([...headings])].filter(c => /[　-鿿＀-￯]/.test(c) && !subset.landing.includes(c));
  check('标题用到的中文字都在字体子集里（否则重跑 node scripts/landing-fonts.mjs）', !uncovered.length, uncovered.join(''));
  // The six cards must have their clip; a gallery tile without one shows its preview image (a new prototype), so
  // that is a note to record it, not a failure.
  const showMedia = TOP.flatMap(t => [`${t.id}.mp4`, `${t.id}.webp`]);
  const absent = showMedia.filter(f => !existsSync(path.join(root, 'site/media', f)));
  check(`六张卡的录像与封面都在 site/media（缺的用 node scripts/record-landing.mjs --only <id> 补录）`, !absent.length, absent.join(' '));
  const unrecorded = expected.filter(id => !existsSync(path.join(root, 'site/media', `${id}.mp4`)));
  if (unrecorded.length) console.log(`  提示：画廊里 ${unrecorded.join('、')} 还没有录像，先显示预览图；node scripts/record-landing.mjs --only ${unrecorded.join(',')}`);

  // ---- 5. the beats follow the reading line; the demo card answers and takes it back ----
  const goTo = k => page.evaluate(`(() => { const s = document.querySelector('.fl-sticky'); const el = document.querySelector('[data-step-block="${k}"]');
    const wide = innerWidth >= 960, h = wide ? 0 : s.offsetHeight, line = wide ? innerHeight * 0.55 : h + (innerHeight - h) * 0.35;
    window.scrollTo(0, el.getBoundingClientRect().top + scrollY - line + 24); return 1; })()`);
  const stepNow = () => page.evaluate(`document.querySelector('.fl-round').dataset.step`);
  const seen = [];
  let beatDots = -1
  for (const k of [1, 2, 3]) {
    await goTo(k); await wait(k === 2 ? 3200 : 2200); seen.push(await stepNow());
    if (k === 2) beatDots = await page.evaluate(dotsLeft('.fl-beat-stage'));
  }
  check('三拍随阅读线依次切换：1 → 2 → 3', seen.join() === '1,2,3', seen);
  check('第 2 拍演完：40 颗点都被吸收进各自的段，尺上没有残留的点', beatDots === 0, beatDots);
  await page.evaluate(`document.querySelector('.fl-card .btns button').click()`);
  await wait(900);
  const answered = await page.evaluate(`({ ans: document.querySelector('.fl-round').classList.contains('ans'), receipt: getComputedStyle(document.querySelector('.fl-receipt')).visibility, text: document.querySelector('.fl-receipt .t').textContent })`);
  await page.evaluate(`document.querySelector('.fl-receipt .undo').click()`);
  await wait(300);
  const undone = await page.evaluate(`!document.querySelector('.fl-round').classList.contains('ans')`);
  check('演示卡：按钮真的作答（原地收成回执），撤回后卡回来', answered.ans && answered.receipt === 'visible' && answered.text.includes(data.beat3.lead.value.actions[0]) && undone, { answered, undone });
  await goTo(4); await wait(1200);
  const looped = await page.evaluate(`({ step: document.querySelector('.fl-round').dataset.step, ans: document.querySelector('.fl-round').classList.contains('ans') })`);
  await goTo(3); await wait(400);
  const back = await page.evaluate(`document.querySelector('.fl-round').classList.contains('ans')`);
  check('滚到回流那一段：没按时自动收成回执（演示）；滚回第三拍，演示的回答撤掉', looped.step === '4' && looped.ans && !back, { looped, back });
  await page.evaluate(`setTimeout(() => document.querySelector('#form-trays .fl-btn.solid').click(), 50), 1`);
  await wait(2000);
  const href = await page.evaluate('location.pathname + location.search');
  // (the prototype then writes its own frame into the address)
  check('手机上点“打开原型”：同一个标签页打开原型本身（形式页带 card=0）', href.startsWith('/prototype/forms/trays.html?card=0'), href);
  check('390 × 844：脚本过程中没有报错', !page.problems.length, page.problems);
  await page.close();

  // ---- 3. reduced motion: the first screen is its end state at once ----
  const played = await open([390, 844]);
  await wait(5200);
  const after = await played.evaluate(heroState);
  const heroDots = await played.evaluate(dotsLeft('.fl-hero'));
  await played.close();
  check('首屏演完：点都被吸收，尺上没有残留的点', heroDots === 0, heroDots);
  const still = await open([390, 844], { reduced: true });
  const immediate = await still.evaluate(heroState);
  const running = await still.evaluate(`document.getAnimations().filter(a => a.playState === 'running').length`);
  const roundStep = await still.evaluate(`document.querySelector('.fl-round').dataset.step`);
  const differing = Object.keys(after).filter(k => after[k] !== immediate[k]);
  check('减弱动态：首屏一打开就是终态（与播放结束后逐项相同），没有动画在跑，三拍从第一拍的终态起', !differing.length && running === 0 && roundStep === '1', { differing, running, roundStep });
  if (shots) { await mkdir(shots, { recursive: true }); await still.shot(path.join(shots, 'reduced-390x844-full.png'), true); }
  await still.close();

  // ---- 2. seven sizes: scroll top to bottom; no errors, no failed requests, no horizontal scroll ----
  for (const size of SIZES) {
    const p = await open(size);
    await wait(400);
    if (shots) { await mkdir(shots, { recursive: true }); await wait(4600); await p.shot(path.join(shots, `${size.join('x')}-first.png`)); }
    let overflow = 0;
    const total = await p.evaluate('document.documentElement.scrollHeight');
    for (let y = 0; y < total; y += Math.round(size[1] * 0.8)) {
      await p.evaluate(`window.scrollTo(0, ${y})`);
      await wait(160);
      overflow = Math.max(overflow, await p.evaluate('document.documentElement.scrollWidth - innerWidth'));
    }
    await wait(900);
    check(`${size.join(' × ')}：从头滚到底没有报错、没有失败的请求、没有横向滚动`, !p.problems.length && overflow <= 0, { problems: p.problems.slice(0, 6), overflow });
    if (shots) await p.shot(path.join(shots, `${size.join('x')}-full.png`), true);
    await p.close();
  }

  // ---- 6. the nav's prototype panel and viewer still work ----
  const desk = await open([1440, 900]);
  await desk.evaluate(`document.querySelector('.fold-menu-bar').click(), 1`);
  await wait(500);
  const panel = await desk.evaluate(`({ open: getComputedStyle(document.querySelector('#fold-prototype-panel')).display !== 'none', cards: document.querySelectorAll('#fold-prototype-panel .fold-gallery-card').length })`);
  await desk.evaluate(`document.querySelector('#fold-prototype-panel .fold-gallery-card').click(), 1`);
  await wait(900);
  const viewer = await desk.evaluate(`({ open: Boolean(document.querySelector('dialog[open]')), frame: document.querySelector('dialog[open] iframe')?.getAttribute('src') || null })`);
  await desk.key('Escape');
  await wait(500);
  const closed = await desk.evaluate(`!document.querySelector('dialog[open]')`);
  check(`导航“全部原型”：面板铺开 ${prototypes.length} 张卡，点一张在弹框里打开，Esc 收回`, panel.open && panel.cards === prototypes.length && viewer.open && Boolean(viewer.frame) && closed, { panel, viewer, closed });
  await desk.evaluate(`document.querySelector('.fl-show .fl-btn.solid').click(), 1`);
  await wait(700);
  const fromCard = await desk.evaluate(`document.querySelector('dialog[open] iframe')?.getAttribute('src') || null`);
  check('桌面上点六张卡的“打开原型”：在同一个弹框里打开', Boolean(fromCard), fromCard);
  check('1440 × 900：面板与弹框过程中没有报错', !desk.problems.length, desk.problems);
  await desk.close();
} finally {
  socket.close();
  chrome.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await server?.close();
}

const failed = results.filter(ok => !ok).length;
console.log(failed ? `\n${failed} 项未通过。` : `\n全部 ${results.length} 项通过。`);
process.exit(failed ? 1 : 0);
