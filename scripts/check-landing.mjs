// 入口页的自动检查：用本机无头 Chrome 打开构建好的站点首页，逐项核对（规格见 site/landing/spec.md「验收」）：
// 1. 页面上每个带 data-k 的数都等于 site/landing/data.json 里那个出处（gallery.count 等于原型总数减六）；
// 2. 七个尺寸（375×667、390×844、430×932、820×1180、1180×820、1440×900、1920×1080）从头滚到底：没有报错、没有失败的请求、
//    没有横向滚动；
// 3. 减弱动态时首屏直接是终态：与正常播放结束后的样子逐项相同，且没有动画在跑；首屏演完后前两扇窗的内容、
//    铺点的盖板都不留残渣，三个处境按钮切得动；
// 4. 画廊块数等于原型总数减六，Top 6 不在其中，其余一个不少；第 3 节六个处境按 LADDER 从窄到宽，各链到它的卡（没有卡的链到原型本身）；
// 5. 三拍按阅读线切换（1 → 2 → 3 → 回流），演示卡的按钮真的作答、撤回；第 2 拍演完后尺上没有残留的点；
// 6. 导航是“处境 · 全部原型 · 从头读起 · 文档”（没有“为什么”，#why 锚点与首屏按钮仍在），“全部原型”的画册面板与查看弹框照常可用；
// 7. 首屏标题的字都在字体子集里，六张卡与画廊的录像文件都在；
// 8. 第 2 节的三幕：第 1 幕按最大的单个来源定比例、消息类的大群那行最长；第 3 幕终态“全部加起来”那根正好顶满整宽，
//    每个单独来源只剩一点点（> 0、远小于整宽），减弱动态时一打开就是这个终态；三幕演的整个过程页面不横向溢出；
// 9. 白话：入口页正文（不含六张原型卡、画廊、弹框）只用白话，不出现 #数字、PR、CI、master、演示里的人名与瑞典语，
//    也不出现演示原文的标题、问题与选项（白话与 data.json 的 plain 字段由第 1 项逐个核对）。
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
import { LADDER, TOP, WHY, galleryOf } from '../site/.vitepress/theme/landing.mjs';
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

// The first screen's computed state: the window's shape, which content and which lit layer shows, the base dots'
// dimming, the cover that lays the field in, the situation buttons, the ledger line.
// Transforms are compared as rounded matrices: an animation that ends on \`none\` computes as the identity matrix.
const paint = `const px = (() => { const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true }); c.canvas.width = c.canvas.height = 1;
    return css => { c.clearRect(0, 0, 1, 1); c.fillStyle = '#000'; c.fillStyle = css; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].join(','); }; })();`;
const heroState = `(() => { ${paint} const q = s => [...document.querySelectorAll('.h2-stage ' + s)];
  const t = e => { const v = getComputedStyle(e).transform, m = new DOMMatrixReadOnly(v === 'none' ? undefined : v); return [m.a, m.b, m.c, m.d, m.e, m.f].map(x => (Math.abs(x) < 0.005 ? 0 : x).toFixed(2)).join(','); };
  const o = e => Number(getComputedStyle(e).opacity).toFixed(2);
  const win = q('.h2-win')[0], ws = getComputedStyle(win);
  return { win: [ws.width, ws.height, ws.borderTopLeftRadius, o(win), t(win)].join('/'), content: q('.h2-c').map(o).join('|'),
    dots: q('.h2-dots').map(o).join('|'), cover: q('.h2-cover').map(e => t(e) + '/' + o(e)).join('|'),
    tiles: q('.h2-desk .tl').map(e => o(e) + t(e)).join('|'), columns: q('.h2-stack .col').map(t).join('|'),
    chips: q('.h2-chip').map(e => px(getComputedStyle(e).color)).join('|'), bar: q('.h2-bar').map(e => t(e) + '/' + o(e)).join('|'),
    ledger: q('.h2-ledger > span').map(o).join('|') }; })()`;
// What must be gone once the first screen has played: the first two windows' content, the cover over the field, the
// first two ledger lines; and exactly one situation button lit.
const heroLeft = `(() => { ${paint} const q = s => [...document.querySelectorAll('.h2-stage ' + s)], o = e => Number(getComputedStyle(e).opacity);
  const cover = q('.h2-cover')[0], field = q('.h2-field')[0], cb = cover.getBoundingClientRect(), fb = field.getBoundingClientRect();
  const lit = q('.h2-chip').filter(e => px(getComputedStyle(e).color) === px(getComputedStyle(document.querySelector('.fl')).color)).length;
  return { c1: o(q('.h2-c1')[0]), c2: o(q('.h2-c2')[0]), lg: q('.lg1, .lg2').map(o).reduce((a, b) => a + b, 0), cover: o(cover) > 0.02 && cb.left < fb.right - 1, lit }; })()`;
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
  // Each row of the third section links to its card when the showcase has one, else to the prototype page itself.
  const rungs = await page.evaluate(`[...document.querySelectorAll('.fl-ladder a')].map(e => ({ id: e.className.replace('g-', ''), href: e.getAttribute('href'),
    card: e.getAttribute('href').startsWith('#form-') ? Boolean(document.querySelector(e.getAttribute('href'))) : null }))`);
  const rungOk = r => (r.href === `#form-${r.id}` && r.card) || (r.card === null && r.href.startsWith('/prototype/') && (r.href.includes(`variant=${r.id}`) || r.href.includes(`/${r.id}.html`)));
  check(`第 3 节六个处境从窄到宽（${LADDER.map(l => l.id).join(' → ')}），各链到它的卡或原型本身`, rungs.map(r => r.id).join() === LADDER.map(l => l.id).join() && rungs.every(rungOk), rungs.filter(r => !rungOk(r)));
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
  check('演示卡：按钮真的作答（原地收成回执），撤回后卡回来', answered.ans && answered.receipt === 'visible' && answered.text.includes(data.beat3.lead.value.plain.actions[0]) && undone, { answered, undone });
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

  // ---- 3. reduced motion: the first screen is its end state at once; the situations switch ----
  const played = await open([390, 844]);
  await wait(9400);
  const after = await played.evaluate(heroState);
  const left = await played.evaluate(heroLeft);
  check('首屏演完：前两扇窗的内容与两行账都已收起，铺点的盖板已移开，只亮一个处境', !left.c1 && !left.c2 && !left.lg && !left.cover && left.lit === 1, left);
  const picks = [];
  for (const k of [1, 2, 3]) {
    await played.evaluate(`document.querySelector('.h2-chip[data-sit="${k}"]').click(), 1`);
    await wait(1200);
    picks.push(await played.evaluate(`(() => { const st = document.querySelector('.h2-stage'), w = document.querySelector('.h2-win').getBoundingClientRect(), c = document.querySelector('.h2-c${k}');
      return { s: st.dataset.s, w: Math.round(w.width), h: Math.round(w.height), shown: Number(getComputedStyle(c).opacity), others: [...document.querySelectorAll('.h2-c')].filter(e => e !== c && Number(getComputedStyle(e).opacity) > 0.02).length,
        pressed: document.querySelector('.h2-chip[data-sit="${k}"]').getAttribute('aria-pressed') }; })()`));
  }
  check('首屏三个处境按得动：窗改形（骑车是圆、桌前 1.7 : 1、复盘最宽），窗里换成那个处境的内容，别的收起', picks.every((p, i) => p.s === String(i + 1) && p.shown === 1 && !p.others && p.pressed === 'true')
    && picks[0].w === picks[0].h && Math.abs(picks[1].w / picks[1].h - 1.7) < 0.06 && picks[2].w > picks[1].w, picks);
  if (played.problems.length) check('390 × 844：首屏播放与切换过程中没有报错', false, played.problems);
  await played.close();
  const still = await open([390, 844], { reduced: true });
  const immediate = await still.evaluate(heroState);
  const running = await still.evaluate(`document.getAnimations().filter(a => a.playState === 'running').length`);
  const roundStep = await still.evaluate(`document.querySelector('.fl-round').dataset.step`);
  const differing = Object.keys(after).filter(k => after[k] !== immediate[k]);
  check('减弱动态：首屏一打开就是终态（与播放结束后逐项相同），没有动画在跑，三拍从第一拍的终态起', !differing.length && running === 0 && roundStep === '1', { differing: differing.map(k => [k, after[k], immediate[k]]), running, roundStep });
  if (shots) { await mkdir(shots, { recursive: true }); await still.shot(path.join(shots, 'reduced-390x844-full.png'), true); }
  await still.close();

  // ---- 8. the second section's three acts (a day of one person: each on its own, added up, rescaled) ----
  const day = data.why.day.value, widest = data.why.widest.value, total = data.why.total.value;
  for (const size of [[390, 844], [1440, 900]]) {
    const p = await open(size);
    await wait(400);
    // Bring the figure into view (its observer adds .in), then hold every animation of it at the end of act 1.
    await p.evaluate(`(() => { const f = document.querySelector('#why .fl-src'); window.scrollTo(0, f.getBoundingClientRect().top + scrollY - 80); return 1; })()`);
    for (let i = 0; i < 40 && !(await p.evaluate(`document.querySelector('#why .fl-src').classList.contains('in')`)); i += 1) await wait(50);
    const act1At = WHY.pour[0] - 60;
    const act1 = await p.evaluate(`(() => { const f = document.querySelector('#why .fl-src');
      const anims = document.getAnimations().filter(a => f.contains(a.effect?.target));
      for (const a of anims) { a.pause(); a.currentTime = ${act1At}; }
      const W = f.querySelector('.row .bar').getBoundingClientRect().width;
      const rows = [...f.querySelectorAll('.row:not(.all)')].map(r => r.querySelector('.b').getBoundingClientRect().width);
      for (const a of anims) a.play();
      return { in: f.classList.contains('in'), anims: anims.length, W, rows }; })()`);
    const longest = act1.rows.indexOf(Math.max(...act1.rows));
    const scaled = act1.rows.every((w, r) => Math.abs(w - day[r].n / widest * act1.W) <= 1.5);
    check(`${size.join(' × ')} 第 2 节第 1 幕：按最大的单个来源定比例（同一比例），最长的是消息类的大群“${day[0].name}”，占满一行`,
      act1.in && act1.anims > 40 && longest === 0 && day[0].kind === '消息' && Math.abs(act1.rows[0] - act1.W) <= 1.5 && scaled, { ...act1, longest, scaled });
    // Let the acts play out for real, watching the page's horizontal overflow all the way through.
    let overflow = -Infinity;
    const until = Date.now() + WHY.end + 900;
    while (Date.now() < until) { overflow = Math.max(overflow, await p.evaluate('document.documentElement.scrollWidth - innerWidth')); await wait(90); }
    const end = await p.evaluate(`(() => { const f = document.querySelector('#why .fl-src'), b = f.querySelector('.row.all .bar').getBoundingClientRect();
      const segs = [...f.querySelectorAll('.sg')].map(e => e.getBoundingClientRect());
      const rows = [...f.querySelectorAll('.row:not(.all)')].map(r => { const bar = r.querySelector('.b'), mk = r.querySelector('.mk');
        const visible = Math.max(bar.getBoundingClientRect().width, Number(getComputedStyle(mk).opacity) > 0.5 ? mk.getBoundingClientRect().width : 0);
        return { b: Math.round(bar.getBoundingClientRect().width * 100) / 100, w: Math.round(visible * 100) / 100, o: Number(getComputedStyle(bar).opacity) }; });
      return { W: b.width, left: Math.min(...segs.map(r => r.left)) - b.left, right: Math.max(...segs.map(r => r.right)) - b.left, rows,
        running: document.getAnimations().filter(a => f.contains(a.effect?.target) && a.playState === 'running').length }; })()`);
    const sumOk = Math.abs(end.left) <= 1 && Math.abs(end.right - end.W) <= Math.max(2, end.W * 0.01);
    const rowsOk = end.rows.every(r => r.w >= 1 && r.w <= end.W * 0.35 && r.o > 0.9);
    check(`${size.join(' × ')} 第 2 节第 3 幕终态：“全部加起来”那根正好顶满整宽（${Math.round(end.W)}px），每个单独来源只剩一点点（≥ 1px、≤ 整宽的 35%）`,
      sumOk && rowsOk && !end.running, { W: end.W, left: end.left, right: end.right, running: end.running, rows: end.rows.filter(r => !(r.w >= 1 && r.w <= end.W * 0.35 && r.o > 0.9)) });
    check(`${size.join(' × ')} 第 2 节三幕演的整个过程中页面不横向溢出`, overflow <= 0, overflow);
    await p.close();
    if (size[0] === 390) {
      // Reduced motion: the figure is at the end of act 3 at once.
      const r = await open(size, { reduced: true });
      await r.evaluate(`(() => { const f = document.querySelector('#why .fl-src'); window.scrollTo(0, f.getBoundingClientRect().top + scrollY - 80); return 1; })()`);
      await wait(200);
      const still = await r.evaluate(`(() => { const f = document.querySelector('#why .fl-src'), b = f.querySelector('.row.all .bar').getBoundingClientRect();
        const segs = [...f.querySelectorAll('.sg')].map(e => e.getBoundingClientRect());
        return { right: Math.max(...segs.map(x => x.right)) - b.left, W: b.width, rows: [...f.querySelectorAll('.row:not(.all) .b')].map(e => Math.round(e.getBoundingClientRect().width * 100) / 100),
          running: document.getAnimations().filter(a => f.contains(a.effect?.target)).length }; })()`);
      check('减弱动态：第 2 节一打开就是第 3 幕的终态（与演完后逐行相同），没有动画', !still.running && Math.abs(still.right - still.W) <= 2
        && still.rows.every((w, i) => Math.abs(w - end.rows[i].b) <= 0.5), { still, end: end.rows.map(x => x.b) });
      await r.close();
    }
  }

  // ---- 9. plain words: the body speaks plainly; the replay's own wording stays in the data ----
  const plain = await open([390, 844]);
  await wait(300);
  const body = await plain.evaluate(`(() => { const c = document.querySelector('.fl').cloneNode(true);
    c.querySelectorAll('.fl-show, .fl-gal, .fl-sheet-back, dialog, style, script').forEach(e => e.remove());
    return c.textContent.replace(/\s+/g, ' '); })()`);
  const banned = [/#\d/, /\bPR\b/, /\bCI\b/, /master/i, /\b(?:Jonas|Berglund|Smilla|Kajsa|Mamma|Ture|Signe|Ulrika|VAB|vab)\b/, /[åäöÅÄÖ]/];
  const hits = banned.map(re => body.match(re)?.[0]).filter(Boolean);
  const originals = [...data.beat2.segments.value.map(x => x.title), ...data.beat3.asks.value.map(x => x.short), data.beat3.lead.value.prompt, ...data.beat3.lead.value.actions,
    data.beat3.loop.example.value.ask, data.beat3.loop.example.value.response.text].filter(t => body.includes(t));
  check('白话：入口页正文（不含原型卡、画廊、弹框）没有 #数字、PR、CI、master、演示里的人名与瑞典语，也没有演示原文的标题、问题与选项', !hits.length && !originals.length, { hits, originals });
  await plain.close();

  // ---- 2. seven sizes: scroll top to bottom; no errors, no failed requests, no horizontal scroll ----
  for (const size of SIZES) {
    const p = await open(size);
    await wait(400);
    if (shots) { await mkdir(shots, { recursive: true }); await wait(9000); await p.shot(path.join(shots, `${size.join('x')}-first.png`)); }
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
  // The nav lost “为什么” (2026-11-03): “从头读起” (/docs/why) says the same; the first screen's button and #why stay.
  // Each item's own label: a link's text, a dropdown's button (not its menu); the screen-reader heading is skipped.
  const nav = await desk.evaluate(`({ items: [...document.querySelectorAll('.VPNavBarMenu > :not(.visually-hidden)')].map(e => (e.querySelector(':scope button') || e).textContent.replace(/\\s+/g, '')).filter(Boolean),
    why: Boolean(document.querySelector('section#why')), cta: [...document.querySelectorAll('.fl a[href="#why"]')].map(a => a.textContent.trim()) })`);
  check('导航是“处境 · 全部原型 · 从头读起 · 文档”，没有“为什么”；首屏“为什么是新问题 ↓”与 #why 锚点仍在',
    nav.items.join('|') === '处境|全部原型|从头读起|文档' && nav.why && nav.cta.some(t => t.startsWith('为什么是新问题')), nav);
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
