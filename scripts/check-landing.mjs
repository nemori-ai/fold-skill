// 入口页的自动检查：用本机无头 Chrome 打开构建好的站点首页，逐项核对（规格见 site/landing/spec.md「验收」）：
// 1. 页面上每个带 data-k 的数都等于 site/landing/data.json 里那个出处（gallery.count 等于原型总数减六）；
// 2. 七个尺寸（375×667、390×844、430×932、820×1180、1180×820、1440×900、1920×1080）从头滚到底：没有报错、没有失败的请求、
//    没有横向滚动；
// 3. 减弱动态时首屏直接是终态：与正常播放结束后的样子逐项相同，且没有动画在跑；首屏演完后前两扇窗的内容、
//    铺点的盖板都不留残渣，三个处境按钮切得动；首屏是示意的一天（data.json hero）：场里亮着的点正好是窗里那几件的输入，
//    桌前朱红的是等你的几件，表盘只给 1 件，而且是桌前最大的那块；
// 4. 画廊块数等于原型总数减六，Top 6 不在其中，其余一个不少，每块都有录像、进了视口就在播；第 3 节六个处境按 LADDER
//    从窄到宽，各链到第五节它的那一块（#form-<id>）；
// 5. 三拍按阅读线切换（1 → 2 → 3 → 回流），演示卡的按钮真的作答、撤回；第 2 拍演完后尺上没有残留的点；
// 6. 导航是“处境 · 全部原型 · 从头读起 · 文档”（没有“为什么”，#why 锚点与首屏按钮仍在），“全部原型”的画册面板与查看弹框照常可用；
// 7. 首屏标题的字都在字体子集里，第五节六块的静帧与画廊的录像文件都在，没有用不到的媒体文件；
// 8. 第 2 节的三幕：第 1 幕按最大的单个来源定比例、占满一行的都是群，一个群一行，没写名字的行由括号数清；第 2 幕每段先竖直落、
//    再水平滑，任何时刻在路上的不超过两批，第 1 幕 ≤ 1.5 秒、第 2 幕 ≤ 2 秒；第 3 幕终态“全部加起来”那根正好顶满整宽，
//    每个单独来源都缩成一点点（≤ 整宽的 8%、≥ 1px），减弱动态时一打开就是这个终态；三幕演的整个过程页面不横向溢出；
// 9. 白话：入口页正文（含第五节六块的文字，不含画廊、弹框；原型本身在 iframe 里）只用白话，不出现 #数字、PR、CI、master、演示里的人名、店名与项目名，
//    也不出现演示原文的标题、问题与选项（白话与 data.json 的 plain 字段由第 1 项逐个核对）；正文与页面描述是平常的书面语，
//    不出现改掉的别扭说法（接得住、交出、落进、暗下、舍掉、让位、一摊……）；
// 10. 第五节六块是实时嵌入的原型（site/.vitepress/theme/live.mjs）：组成与顺序是定下的六个；首屏载入后还没有任何 iframe；
//    滚进来后，显示着的原型都在时钟的那一帧、显示静帧的块也是那一帧（抽样多次）；iframe 不接收指针与焦点，手指在块上
//    滑动滚的是页面；手机上同时活着的 iframe 不超过 2 个；减弱动态时不建 iframe，停在最后一帧。
// 11. 不出白块（spec.md「第五轮」）：第五节每块与画廊每块底下都有内联的占位缩略图（site/landing/placeholders.json，与它取自的
//    静帧和预览图一致）；滚过第五节的每一帧里，屏幕上的块要么静帧已载入、要么有占位，原型页面只在发来 shown 之后才叠上去；
// 12. 手机上缩得看不清的块（实际缩放 < landing.mjs LEGIBLE.scale）才写“在电脑上看更清楚”，平板与桌面不写；查看弹框在手机上
//    打开按桌面排版的原型时也写这一句，窄的不写；手机上点画廊里的“桌面”块，说明卡里也有这一句；
// 13. 旧版入口：整站只有入口页首屏一个链接（同一标签页打开 /legacy/，那里是 scripts/legacy-site.mjs 另外构建的旧站），375 / 390 / 768 /
//    1440 下不滚动就看得见、不压导航、标题、表盘与小字，绝对定位不挤动首屏；构建出的页面里没有写死 fold-v2 的地址。
//
//   npm run site:build && node scripts/check-landing.mjs            # 自己起服务读 dist/
//   node scripts/check-landing.mjs --base http://127.0.0.1:4174      # 或检查已在跑的站点
//   node scripts/check-landing.mjs --shots .local/landing-shots       # 顺带存七个尺寸的首屏与整页截图
//
// 只用 Node 22 内置的 WebSocket 驱动本机 Chrome（CHROME 可指定路径），不装依赖。任一项不过时退出码为 1。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prototypes } from '../site/.vitepress/theme/prototypes.mjs';
import { DESK_ONLY, LADDER, LEGACY, LEGIBLE, LIVE, TOP, WHY, galleryOf } from '../site/.vitepress/theme/landing.mjs';
import { serve } from './serve-static.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const shots = option('--shots') && path.resolve(root, option('--shots'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const SIZES = [[375, 667], [390, 844], [430, 932], [820, 1180], [1180, 820], [1440, 900], [1920, 1080]];
// The six of the fifth section, in the order the user set (2026-11-03).
const SIX = ['a', 'trays', 'watch', 'duo', 'b', 'multiples'];
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let server = null;
if (!option('--base')) {
  if (!existsSync(path.join(root, 'dist/index.html'))) { console.error('dist/ 还没有构建：先运行 npm run site:build，或用 --base 指向在跑的站点。'); process.exit(1); }
  // cached like the deployed site, so the live prototypes share one download of the replay
  server = await serve(path.join(root, 'dist'), { revalidate: true });
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
    send: s,
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
// The fifth section now: the clock's frame and, for every block on screen, what it shows — a live page (its model's
// own frame, read from inside the page) or its still (the frame in the image it displays).
const liveState = `(() => { const sec = document.querySelector('#forms'), vh = innerHeight;
  return { clock: Number(sec.dataset.frame), frames: document.querySelectorAll('iframe').length, blocks: [...sec.querySelectorAll('[data-live]')].map(el => {
    const r = el.getBoundingClientRect(), f = el.querySelector('.lv-live'), m = f && (f.contentWindow.foldLab || f.contentWindow.foldForm)?.model;
    return { id: el.dataset.live, onScreen: r.bottom > 0 && r.top < vh, live: Boolean(f), on: Boolean(f?.classList.contains('on')), at: m ? m.snapshot().index : null,
      still: Number((el.querySelector('img').currentSrc.match(/-(\\d+)\\.webp/) || [])[1]) }; }) }; })()`;
const offFrame = st => st.blocks.filter(b => b.onScreen && (b.on ? b.at !== st.clock : b.still !== st.clock)).map(b => `${b.id} ${b.on ? '页面' : '静帧'} ${b.on ? b.at : b.still} ≠ ${st.clock}`);
// One sample: what is on screen must be the clock's frame. A mismatch is looked at again 300 ms later (a sample can land
// between the clock moving on and the pages hearing of it); only one that stays counts.
async function sampleLive(page) {
  let st = await page.evaluate(liveState), off = offFrame(st);
  if (off.length) { await wait(300); st = await page.evaluate(liveState); off = offFrame(st); }
  return { st, off };
}
// Every animation frame while a block of the fifth section is on screen: it must have something under any page (its
// still loaded, or its inline thumbnail), and a page may be visible only once it has posted {fold: 'shown'}.
const coverWatch = `(() => { const shown = new WeakSet(); window.__cover = { frames: 0, checks: 0, empty: [], early: [] };
  addEventListener('message', e => { if (e.data && e.data.fold === 'shown' && e.source) shown.add(e.source); });
  const loop = () => { let any = false;
    for (const el of document.querySelectorAll('#forms [data-live]')) { const r = el.getBoundingClientRect(); if (r.bottom <= 0 || r.top >= innerHeight) continue;
      any = true; window.__cover.checks += 1;
      const img = el.querySelector('img'), f = el.querySelector('.lv-live');
      if (!(img.complete && img.naturalWidth) && getComputedStyle(el).backgroundImage === 'none') window.__cover.empty.push(el.dataset.live);
      if (f && Number(getComputedStyle(f).opacity) > 0 && !shown.has(f.contentWindow)) window.__cover.early.push(el.dataset.live); }
    if (any) window.__cover.frames += 1;
    requestAnimationFrame(loop); };
  requestAnimationFrame(loop); return 1; })()`;
const coverOk = c => c.frames > 30 && !c.empty.length && !c.early.length;
const coverSay = c => ({ frames: c.frames, checks: c.checks, empty: [...new Set(c.empty)], early: [...new Set(c.early)] });
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
  const cards = await page.evaluate(`[...document.querySelectorAll('.lv-card')].map(e => e.id.replace('form-', ''))`);
  check(`第五节六块按定下的组成与顺序：${SIX.join(' → ')}`, cards.join() === SIX.join() && TOP.map(t => t.id).join() === SIX.join(), { cards, top: TOP.map(t => t.id) });
  // Each row of the third section scrolls to its block in the fifth section (all six are there, A included).
  const rungs = await page.evaluate(`[...document.querySelectorAll('.fl-ladder a')].map(e => ({ id: e.className.replace('g-', ''), href: e.getAttribute('href'),
    card: e.getAttribute('href').startsWith('#form-') ? Boolean(document.querySelector(e.getAttribute('href'))) : null }))`);
  const rungOk = r => r.href === `#form-${r.id}` && r.card;
  check(`第 3 节六个处境从窄到宽（${LADDER.map(l => l.id).join(' → ')}），各滚到第五节它的那一块`, rungs.map(r => r.id).join() === LADDER.map(l => l.id).join() && rungs.every(rungOk), rungs.filter(r => !rungOk(r)));
  const headings = await page.evaluate(`[...document.querySelectorAll('.fl .fl-h')].map(e => e.textContent).concat([...document.querySelectorAll('.lv-txt h3')].map(e => e.firstChild.textContent)).join('')`);
  const subset = JSON.parse(await readFile(path.join(root, 'site/fonts/subset.json'), 'utf8'));
  const uncovered = [...new Set([...headings])].filter(c => /[　-鿿＀-￯]/.test(c) && !subset.landing.includes(c));
  check('标题用到的中文字都在字体子集里（否则重跑 node scripts/landing-fonts.mjs）', !uncovered.length, uncovered.join(''));
  // The six play live over a still of each frame they play; every gallery tile plays its recording.
  const stills = TOP.flatMap(t => LIVE.frames.map(f => `live/${t.id}-${f}.webp`));
  const absent = stills.filter(f => !existsSync(path.join(root, 'site/media', f)));
  check(`六块的静帧都在 site/media/live（${TOP.length} × ${LIVE.frames.length} 张；缺的用 node scripts/record-landing.mjs --only <id> 重截）`, !absent.length, absent.join(' '));
  const unrecorded = expected.filter(id => !existsSync(path.join(root, 'site/media', `${id}.mp4`)));
  const videos = await page.evaluate(`[...document.querySelectorAll('.fl-tile[data-id]')].filter(e => !e.querySelector('video[data-src]')).map(e => e.dataset.id)`);
  check(`画廊每一块都有录像（缺的用 node scripts/record-landing.mjs --only <id> 补录）`, !unrecorded.length && !videos.length, { unrecorded, videos });
  const stray = [...(await readdir(path.join(root, 'site/media'))).filter(f => /\.(mp4|webp)$/.test(f) && !expected.includes(f.replace(/\.(mp4|webp)$/, ''))),
    ...(await readdir(path.join(root, 'site/media/live'))).map(f => `live/${f}`).filter(f => !stills.includes(f))];
  check('site/media 里没有用不到的录像、封面或静帧', !stray.length, stray);

  // ---- 11. no white blocks: an inline thumbnail under every block and tile, made from the file it stands in for ----
  const thumbs = JSON.parse(await readFile(path.join(root, 'site/landing/placeholders.json'), 'utf8'));
  const hashOf = async file => createHash('sha1').update(await readFile(path.join(root, 'site', file))).digest('hex').slice(0, 12);
  const stale = [];
  for (const [group, id, from] of [...TOP.map(t => ['live', t.id, `media/live/${t.id}-${LIVE.frames[0]}.webp`]), ...expected.map(id => ['gallery', id, prototypes.find(x => x.id === id).preview.slice(1)])]) {
    const source = thumbs.sources[`${group}.${id}`];
    if (!thumbs[group][id] || !source) stale.push(`缺 ${group}.${id}`);
    else if (source.from !== from || source.sha !== await hashOf(from)) stale.push(`${group}.${id} 与 ${from} 不一致`);
  }
  check('占位缩略图：第五节六块与画廊每块都有，且与取自的静帧、预览图一致（不一致时运行 node scripts/record-landing.mjs --placeholders）', !stale.length, stale);
  const under = await page.evaluate(`Promise.all([...document.querySelectorAll('#forms [data-live], .fl-tile .im')].map(async el => {
    const url = (getComputedStyle(el).backgroundImage.match(/url\\("?(data:image\\/webp;base64,[^")]+)/) || [])[1];
    let w = 0;
    if (url) { const im = new Image(); im.src = url; try { await im.decode(); w = im.naturalWidth; } catch {} }
    return { id: el.dataset.live || el.closest('.fl-tile').querySelector('.tn').textContent, w }; }))`);
  const bare = under.filter(x => !x.w);
  check(`第五节 6 块与画廊 ${under.length - 6} 块（轮播的两份）底下都有能解码的内联占位，图还没到时块里也不是空白`, under.length === 6 + 2 * expected.length && !bare.length, bare.map(x => x.id));

  // ---- 12. on a phone, the blocks shown too small to read say so in one line; the others do not ----
  const legible = await page.evaluate(`[...document.querySelectorAll('.lv-card')].map(c => { const f = c.querySelector('[data-live]'), h = c.querySelector('.lv-small'), r = h.getBoundingClientRect();
    return { id: f.dataset.live, scale: Math.round(f.clientWidth / Number(f.dataset.w) * 1000) / 1000, shown: getComputedStyle(h).display !== 'none' && r.width > 0,
      text: h.textContent.trim(), inside: r.right <= c.querySelector('.lv-at').getBoundingClientRect().right + 0.5, color: getComputedStyle(h).color }; })`);
  const wrongHint = legible.filter(x => x.shown !== x.scale < LEGIBLE.scale || x.text !== LEGIBLE.hint || (x.shown && !x.inside));
  const ver = await page.evaluate(`getComputedStyle(document.querySelector('.fl-card .tag')).color`);
  check(`390 × 844：缩放低于 ${LEGIBLE.scale} 的块才写“${LEGIBLE.hint}”（${legible.filter(x => x.shown).map(x => `${x.id} ${x.scale}`).join('、')}），其余不写（${legible.filter(x => !x.shown).map(x => `${x.id} ${x.scale}`).join('、')}）；不用朱红`,
    legible.length === 6 && legible.some(x => x.shown) && legible.some(x => !x.shown) && !wrongHint.length && legible.every(x => x.color !== ver), wrongHint);
  // a gallery tile laid out for a desk, tapped on a phone: its sheet says the same
  const deskTile = expected.find(id => DESK_ONLY.has(id));
  await page.evaluate(`document.querySelector('.fl-tile[data-id="${deskTile}"]').click(), 1`);
  await wait(300);
  const sheetText = await page.evaluate(`document.querySelector('.fl-sheet')?.textContent || ''`);
  await page.evaluate(`document.querySelector('.fl-sheet .ghost')?.click(), 1`);
  check(`390 × 844：点画廊里按电脑排版的块（${deskTile}），说明卡里也写“${LEGIBLE.hint}”`, sheetText.includes(LEGIBLE.hint), sheetText);

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
  await page.evaluate(`setTimeout(() => document.querySelector('#form-trays .lv-txt .fl-btn').click(), 50), 1`);
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
  // The first screen is an illustrative day (data.json hero): the dots lit in each window are exactly the inputs of the
  // items in it, the desk's vermilion tiles are the ones waiting for you, and the watch gets one item, the biggest tile.
  const heroDay = await still.evaluate(`(() => { const marks = lv => (document.querySelector('.h2-l' + lv + ' path')?.getAttribute('d').match(/h/g) || []).length;
    const tiles = [...document.querySelectorAll('.h2-desk .tl')].map(t => ({ cls: t.className, a: parseFloat(t.style.getPropertyValue('--w')) * parseFloat(t.style.getPropertyValue('--h')) }));
    return { lit: [1, 2, 3, 4].map(marks), tiles, watch: document.querySelector('.h2-c1 .n').textContent.trim() }; })()`);
  const dayItems = data.hero.items.value, inputsOf = list => list.reduce((a, it) => a + it.inputs, 0);
  const litWant = [inputsOf(data.hero.done.value), inputsOf(dayItems.filter(it => it.turn === 'agent')), inputsOf(dayItems.filter(it => it.turn === 'you' && !it.urgent)), inputsOf(dayItems.filter(it => it.urgent))];
  const leadTiles = heroDay.tiles.filter(t => /\blead\b/.test(t.cls)), biggest = Math.max(...heroDay.tiles.map(t => t.a));
  const watchItem = dayItems.find(it => it.id === data.hero.lead.value.item);
  check(`首屏（示意的一天）：场里亮着的点正好是窗里那几件的输入（表盘 ${litWant[3]}、等你 ${litWant[2]}、Agent ${litWant[1]}、今天办完的 ${litWant[0]}），桌前 ${dayItems.length} 件里朱红的是等你的 ${data.hero.open.value} 件，表盘只给 1 件，是最大的那块“${watchItem?.name}”`,
    heroDay.lit.join() === litWant.join() && heroDay.tiles.length === dayItems.length + (data.hero.blank.value ? 1 : 0)
      && heroDay.tiles.filter(t => /\byou\b/.test(t.cls)).length === data.hero.open.value && data.hero.urgent.value === 1 && dayItems.filter(it => it.urgent).length === 1
      && watchItem?.urgent && watchItem.turn === 'you' && heroDay.watch === '1' && leadTiles.length === 1 && leadTiles[0].a === biggest,
    { lit: heroDay.lit, litWant, tiles: heroDay.tiles.length, lead: leadTiles, biggest, watch: heroDay.watch });
  if (shots) { await mkdir(shots, { recursive: true }); await still.shot(path.join(shots, 'reduced-390x844-full.png'), true); }
  await still.close();

  // ---- 8. the second section's three acts (a day of one person: each on its own, added up, rescaled) ----
  const day = data.why.day.value, widest = data.why.widest.value, total = data.why.total.value;
  for (const size of [[390, 844], [1440, 900]]) {
    const p = await open(size);
    await wait(400);
    // Bring the figure into view (its observer adds .in), then hold every animation of it at chosen times: the end of
    // act 1, then every 40 ms through act 2, then just before act 3 (where every piece of the sum is at rest).
    await p.evaluate(`(() => { const f = document.querySelector('#why .fl-src'); window.scrollTo(0, f.getBoundingClientRect().top + scrollY - 80); return 1; })()`);
    for (let i = 0; i < 40 && !(await p.evaluate(`document.querySelector('#why .fl-src').classList.contains('in')`)); i += 1) await wait(50);
    const act1At = WHY.pour[0] - 60;
    const act1 = await p.evaluate(`(() => { const f = document.querySelector('#why .fl-src');
      const anims = document.getAnimations().filter(a => f.contains(a.effect?.target));
      for (const a of anims) { a.pause(); a.currentTime = ${act1At}; }
      const W = f.querySelector('.row .bar').getBoundingClientRect().width;
      const rows = [...f.querySelectorAll('.row:not(.all)')].map(r => r.querySelector('.b').getBoundingClientRect().width);
      const named = [...f.querySelectorAll('.row:not(.all) .nm')].filter(e => e.textContent.trim()).length;
      const brackets = [...f.querySelectorAll('.brk')].map(e => [Number(getComputedStyle(e).getPropertyValue('--c')), Number(e.querySelector('b').textContent.match(/\\d+/)?.[0])]);
      return { in: f.classList.contains('in'), anims: anims.length, W, rows, named, brackets }; })()`);
    const full = act1.rows.map((w, r) => [w, r]).filter(([w]) => Math.abs(w - act1.W) <= 1.5).map(([, r]) => r);
    const scaled = act1.rows.every((w, r) => Math.abs(w - day[r].n / widest * act1.W) <= 1.5);
    const bracketsOk = act1.brackets.every(([c, said]) => c === said) && act1.named + act1.brackets.reduce((a, [c]) => a + c, 0) === day.length;
    check(`${size.join(' × ')} 第 2 节第 1 幕：按最大的单个来源定比例（同一比例），占满一行的都是群（第一行“${day[0].name}”）；一个群一行，没写名字的行由括号数清`,
      act1.in && act1.anims > 40 && full[0] === 0 && full.every(r => day[r].kind === '群聊') && scaled && bracketsOk, { ...act1, rows: undefined, full, scaled, bracketsOk });
    const act2 = await p.evaluate(`(() => { const f = document.querySelector('#why .fl-src'), anims = document.getAnimations().filter(a => f.contains(a.effect?.target));
      const segs = [...f.querySelectorAll('.sg')], bar = f.querySelector('.row.all .bar').getBoundingClientRect();
      const at = t => { for (const a of anims) a.currentTime = t; return segs.map(e => { const r = e.getBoundingClientRect();
        return { l: r.left, cy: r.top + r.height / 2, h: r.height, o: Number(getComputedStyle(e).opacity), b: Number(getComputedStyle(e).getPropertyValue('--b')) }; }); };
      const rest = at(${WHY.rescale[0]} - 1), sumY = rest[0].cy, samples = [];
      for (let t = ${WHY.pour[0]}; t < ${WHY.rescale[0]}; t += 40) {
        const moving = at(t).map((s, i) => ({ ...s, i })).filter(s => s.o > 0.5 && (Math.abs(s.l - rest[s.i].l) > 0.5 || Math.abs(s.cy - rest[s.i].cy) > 0.5 || Math.abs(s.h - rest[s.i].h) > 0.5));
        const diagonal = moving.filter(s => Math.abs(s.l - bar.left) > 1 && Math.abs(s.cy - sumY) > 1).map(s => s.i);
        samples.push({ t, moving: moving.length, batches: new Set(moving.map(s => s.b)).size, diagonal });
      }
      for (const a of anims) a.currentTime = 0;
      for (const a of anims) a.play();
      return { samples, rows: f.querySelectorAll('.row:not(.all)').length, batches: Math.max(...segs.map(e => Number(getComputedStyle(e).getPropertyValue('--b')))) + 1 }; })()`);
    const act1Ms = WHY.grow[0] + (act2.rows - 1) * WHY.grow[1] + WHY.grow[2], act2Ms = (act2.batches - 1) * WHY.pour[1] + WHY.pour[2];
    const crowded = act2.samples.filter(s => s.batches > 2 || s.diagonal.length);
    check(`${size.join(' × ')} 第 2 节第 2 幕有秩序：每段先竖直落、再水平滑（没有斜飞），任何时刻在路上的不超过两批；第 1 幕 ≤ 1.5 秒（${act1Ms} ms）、第 2 幕 ≤ 2 秒（${act2Ms} ms）`,
      act2.samples.some(s => s.moving) && !crowded.length && act1Ms <= 1500 && act2Ms <= 2000,
      { crowded: crowded.slice(0, 4), most: Math.max(...act2.samples.map(s => s.batches)), act1Ms, act2Ms });
    // Then the acts play out for real from the start, watching the page's horizontal overflow all the way through.
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
    const sliver = r => r.w >= 1 && r.w <= end.W * 0.08 && r.o > 0.9;
    const longestEnd = Math.max(...end.rows.map(r => r.w));
    check(`${size.join(' × ')} 第 2 节第 3 幕终态：“全部加起来”那根正好顶满整宽（${Math.round(end.W)}px），每个单独来源都缩成一点点（最长的 ${(longestEnd / end.W * 100).toFixed(1)}% ≤ 整宽的 8%，最短的 ≥ 1px）`,
      sumOk && end.rows.every(sliver) && !end.running, { W: end.W, left: end.left, right: end.right, running: end.running, rows: end.rows.filter(r => !sliver(r)) });
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
    // the fifth section's own words count too (its prototypes play inside iframes, whose text is not part of this page)
    c.querySelectorAll('.fl-gal, .fl-sheet-back, dialog, style, script').forEach(e => e.remove());
    return c.textContent.replace(/\s+/g, ' '); })()`);
  // the replay's cast (founder, corpus/founder/OUTLINE.md §2: people, the pets, the companies and the open-source project are
  // said by role on the page), plus the older corpus's (composite) Swedish names
  const banned = [/#\d/, /\bPR\b/, /\bCI\b/, /master/i,
    /陆晨|韩敏|可可|豆豆|土豆|郑婉|孟洁|何嘉|高翔|宋悦|罗晓雯|邓一凡|范志强|老范|姚佳|杨帆|王姐|小金|曹店长|沈律师|白鹭|铃语|听澜|云阶|声通云|曲声|剪约|燃力|禾木/,
    /\b(?:saydone|Harborline|Mateo|Priya|Lucas|Cici)\b/i,
    /\b(?:Jonas|Berglund|Smilla|Kajsa|Mamma|Ture|Signe|Ulrika|VAB|vab)\b/, /[åäöÅÄÖ]/];
  const hits = banned.map(re => body.match(re)?.[0]).filter(Boolean);
  const originals = [...data.beat2.segments.value.map(x => x.title), ...data.beat3.asks.value.map(x => x.short), data.beat3.lead.value.prompt, ...data.beat3.lead.value.actions,
    data.beat3.loop.example.value.ask, data.beat3.loop.example.value.response.text]
    // an original that is already plain (“不答应”) is its own plain words
    .filter(t => body.includes(t) && !data.beat3.lead.value.plain.actions.includes(t));
  check('白话：入口页正文（含第五节的文字，不含画廊、弹框）没有 #数字、PR、CI、master、演示里的人名、店名、公司名与开源项目名，也没有演示原文的标题、问题与选项', !hits.length && !originals.length, { hits, originals });
  // Plain written Chinese (the user, 2026-11-03): the contrived phrasings that were rewritten stay out of the body and the description.
  const description = await plain.evaluate(`document.querySelector('meta[name="description"]')?.content || ''`);
  const stiff = ['接得住', '交出', '落进', '暗下', '舍掉', '让位', '让出', '一摊', '开口', '涌入', '摊开', '回话', '刻痕', '回流', '折掉']
    .filter(w => body.includes(w) || description.includes(w));
  check('平常的书面语：入口页正文与页面描述里没有“接得住、交出、落进、暗下、舍掉、让位、一摊”这类别扭的说法', description.length > 20 && !stiff.length, { stiff, description });
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
  await desk.evaluate(`document.querySelector('.fl-show .lv-txt .fl-btn').click(), 1`);
  await wait(700);
  const fromCard = await desk.evaluate(`document.querySelector('dialog[open] iframe')?.getAttribute('src') || null`);
  check('桌面上点六张卡的“打开原型”：在同一个弹框里打开', Boolean(fromCard), fromCard);
  await desk.evaluate(`document.querySelector('.fold-viewer [aria-label="关闭"]').click(), 1`);
  await wait(400);
  await desk.evaluate(`document.querySelector('.fold-menu-bar').click(), 1`);
  await wait(400);
  await desk.evaluate(`document.querySelector('#fold-prototype-panel a.fold-gallery-card[href*="/${deskTile}."]').click(), 1`);
  await wait(3200);
  const deskViewerHint = await desk.evaluate(`Boolean(document.querySelector('dialog[open] .fold-viewer-hint'))`);
  check(`1440 × 900：弹框里打开按电脑排版的原型（${deskTile}），不写“${LEGIBLE.hint}”`, !deskViewerHint, deskViewerHint);
  check('1440 × 900：面板与弹框过程中没有报错', !desk.problems.length, desk.problems);
  await desk.close();

  // ---- 13. the old site: one quiet link in a corner of the first screen; 12. no hint on a pad or a desk ----
  for (const size of [[375, 667], [390, 844], [768, 1024], [1440, 900]]) {
    const p = await open(size);
    await wait(300);
    const legacy = await p.evaluate(`(() => { const links = [...document.querySelectorAll('a[href="${LEGACY}"]')], a = links[0];
      if (!a) return { count: 0 };
      const box = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      const text = e => { const range = document.createRange(); range.selectNodeContents(e); return box(range); };
      const hit = (x, y) => !(x.r <= y.l || y.r <= x.l || x.b <= y.t || y.b <= x.t);
      const me = box(a), words = text(a), nav = box(document.querySelector('.VPNav'));
      const others = { nav, title: text(document.querySelector('.fl-hero h1')), kicker: text(document.querySelector('.fl-hero .fl-kick')), stage: box(document.querySelector('.h2-stage')),
        buttons: box(document.querySelector('.fl-ctas')), cue: text(document.querySelector('.fl-cue a')) };
      const layout = () => ['.fl-hero h1', '.fl-hero .fl-kick', '.h2-stage', '.fl-cue', '#why'].map(s => JSON.stringify(box(document.querySelector(s)))).join();
      const withLink = layout(); a.style.display = 'none'; const without = layout(); a.style.display = '';
      return { count: links.length, text: a.textContent.replace(/\\s+/g, ''), href: a.getAttribute('href'), target: a.target, inNav: Boolean(a.closest('.VPNav, .VPNavScreen')), inHero: Boolean(a.closest('.fl-hero')),
        seen: words.t >= nav.b - 0.5 && words.b <= innerHeight && words.l >= 0 && words.r <= innerWidth, overlaps: Object.entries(others).filter(([, o]) => o.r > o.l && hit(words, o)).map(([k]) => k),
        target44: me.b - me.t >= 40, moved: withLink !== without, size: parseFloat(getComputedStyle(a).fontSize), at: [Math.round(words.l), Math.round(words.t)] }; })()`);
    check(`${size.join(' × ')}：首屏一角有一个“旧版”链接（${legacy.at?.join(', ')}），同一标签页打开 ${LEGACY}（路由不拦截），不滚动就看得见，不压导航、标题、小字、表盘与按钮，不挤动首屏`,
      legacy.count === 1 && legacy.text.startsWith('旧版') && legacy.href === LEGACY && legacy.target === '_self' && !legacy.inNav && legacy.inHero
        && legacy.seen && !legacy.overlaps.length && legacy.target44 && !legacy.moved && legacy.size <= 12, legacy);
    if (size[0] >= 700) {
      const hints = await p.evaluate(`[...document.querySelectorAll('.lv-small')].filter(h => getComputedStyle(h).display !== 'none').length`);
      check(`${size.join(' × ')}：平板与桌面上第五节不写“${LEGIBLE.hint}”`, hints === 0, hints);
    }
    if (shots) { await mkdir(shots, { recursive: true }); await wait(9000); await p.shot(path.join(shots, `legacy-${size.join('x')}.png`)); }
    await p.close();
  }
  // a click goes to /legacy/ as a page of its own (a full load of the old site, not VitePress's router)
  const away = await open([390, 844]);
  await away.evaluate(`(window.__landing = 1, document.querySelector('a.fl-legacy').click(), 1)`);
  await wait(1500);
  const went = await away.evaluate(`({ path: location.pathname, sameDocument: window.__landing === 1 })`);
  check(`点“旧版”：同一个标签页整页打开 ${LEGACY}，不被站内路由接走`, went.path === LEGACY && !went.sameDocument, went);
  await away.close();
  // the viewer on a phone (the nav's “全部原型”): a page laid out for a desk says so under its name; a narrow one does not
  const phoneViewer = await open([390, 844]);
  await phoneViewer.evaluate(`document.querySelector('.VPNavBarHamburger').click(), 1`);
  await wait(400);
  await phoneViewer.evaluate(`document.querySelector('.fold-menu-screen').click(), 1`);
  await wait(500);
  const viewerHint = [];
  for (const id of [deskTile, 'trays']) {
    await phoneViewer.evaluate(`document.querySelector('#fold-prototype-panel a.fold-gallery-card[href*="/${id}."]').click(), 1`);
    await wait(3200);
    viewerHint.push(await phoneViewer.evaluate(`(() => { const h = document.querySelector('dialog[open] .fold-viewer-hint'), bar = document.querySelector('dialog[open] .fold-viewer-bar'), f = document.querySelector('dialog[open] iframe');
      let wide = 0; try { wide = f.contentDocument.documentElement.scrollWidth; } catch {}
      return { id: '${id}', hint: h ? h.textContent.trim() : null, bar: Math.round(bar.getBoundingClientRect().height), fit: Math.round(f.clientWidth / wide * 100) / 100 }; })()`));
    await phoneViewer.evaluate(`document.querySelector('.fold-viewer [aria-label="关闭"]').click(), 1`);
    await wait(400);
  }
  check(`390 × 844：弹框里打开按电脑排版的原型（${deskTile}，宽度只显示 ${viewerHint[0].fit}）写“${LEGIBLE.hint}”，窄的（trays ${viewerHint[1].fit}）不写，标题栏高度不变`,
    viewerHint[0].hint === LEGIBLE.hint && viewerHint[0].fit < LEGIBLE.scale && viewerHint[1].hint === null && viewerHint[0].bar === viewerHint[1].bar, viewerHint);
  if (phoneViewer.problems.length) check('390 × 844：手机上的查看弹框没有报错', false, phoneViewer.problems);
  await phoneViewer.close();
  // the built site: the old site is linked from the landing alone, and no page names the fold-v2 address
  if (server) {
    const pages = (await readdir(path.join(root, 'dist'), { recursive: true })).filter(f => f.endsWith('.html'));
    const linking = [], v2 = [];
    for (const f of pages) {
      const html = await readFile(path.join(root, 'dist', f), 'utf8');
      // links and meta only (href / src / content): the deployment notes may name both hosts in prose. The old site
      // itself (dist/legacy/, built by scripts/legacy-site.mjs) links to its own home there; only this site's pages count.
      const n = f.startsWith(LEGACY.slice(1)) ? 0 : html.split(`href="${LEGACY}"`).length - 1;
      if (n) linking.push(`${f} × ${n}`);
      if (/(?:href|src|content)="[^"]*fold-v2/.test(html)) v2.push(f);
    }
    check(`构建出的 ${pages.length} 个页面里，只有入口页链到旧版（一处），没有页面的链接、canonical 或 og:url 写死 fold-v2`, linking.join() === 'index.html × 1' && !v2.length, { linking, v2 });
  }

  // ---- 8. the six, live: nothing before the section, one frame on screen, no input, a phone keeps two pages ----
  const desk8 = await open([1440, 900]);
  await desk8.evaluate(coverWatch);
  await wait(1500);
  const early = await desk8.evaluate(`({ frames: document.querySelectorAll('iframe').length, asked: performance.getEntriesByType('resource').filter(e => e.name.includes('/prototype/') || e.name.includes('/media/live/')).length })`);
  check('首屏载入后，第五节还没有任何 iframe，也没有请求原型或静帧', early.frames === 0 && early.asked === 0, early);
  await desk8.evaluate(`(() => { const el = document.querySelector('#forms .lv-grid'); scrollTo(0, el.getBoundingClientRect().top + scrollY - 40); return 1; })()`);
  await wait(7000);
  const deskSamples = [];
  for (let i = 0; i < 10; i += 1) { await wait(1700 + Math.round(Math.random() * 1400)); deskSamples.push(await sampleLive(desk8)); }
  const deskOff = deskSamples.flatMap(x => x.off), deskClocks = new Set(deskSamples.map(x => x.st.clock));
  const deskLive = Math.max(...deskSamples.map(x => x.st.blocks.filter(b => b.on).length));
  check(`1440 × 900：抽样 ${deskSamples.length} 次（走过 ${deskClocks.size} 轮），显示着的 ${deskLive} 个原型与静帧都在时钟的那一帧`, !deskOff.length && deskClocks.size >= 3 && deskLive >= 4, { off: deskOff, clocks: [...deskClocks], deskLive });
  const inputs = await desk8.evaluate(`[...document.querySelectorAll('#forms .lv-live')].map(f => { const r = f.closest('[data-live]').getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { id: f.closest('[data-live]').dataset.live, pointer: getComputedStyle(f).pointerEvents, inert: f.inert, tab: f.tabIndex, hit: hit ? hit.tagName : null }; })`);
  check('iframe 不接收指针与焦点：pointer-events none、inert、tabindex −1，块上点到的是外面的链接', inputs.length >= 4 && inputs.every(x => x.pointer === 'none' && x.inert && x.tab === -1 && x.hit !== 'IFRAME'), inputs);
  // the gallery below: every tile in view plays its recording
  await desk8.evaluate(`(() => { const el = document.querySelector('#all .fl-row'); scrollTo(0, el.getBoundingClientRect().top + scrollY - 120); return 1; })()`);
  await wait(3500);
  const tilesNow = await desk8.evaluate(`[...document.querySelectorAll('.fl-tile')].filter(t => { const r = t.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })
    .map(t => { const v = t.querySelector('video'); return { id: t.dataset.id || t.querySelector('.tn')?.textContent, playing: Boolean(v && !v.paused && v.readyState >= 2 && v.currentTime > 0) }; })`);
  check(`画廊：视口里的 ${tilesNow.length} 块都在自动播放录像`, tilesNow.length >= 6 && tilesNow.every(t => t.playing), tilesNow.filter(t => !t.playing));
  const deskCover = await desk8.evaluate('window.__cover');
  check(`1440 × 900：第五节在屏幕上的 ${deskCover.frames} 帧里，每块底下都有静帧或占位，原型页面都在发来 shown 之后才显示`, coverOk(deskCover), coverSay(deskCover));
  check('1440 × 900：第五节播放中没有报错', !desk8.problems.length, desk8.problems);
  await desk8.close();

  const phone8 = await open([390, 844]);
  await phone8.evaluate(coverWatch);
  await wait(1200);
  await phone8.evaluate(`(() => { window.__live = 0; new MutationObserver(() => { window.__live = Math.max(window.__live, document.querySelectorAll('.lv-live').length); }).observe(document.body, { childList: true, subtree: true }); return 1; })()`);
  const top8 = await phone8.evaluate(`(() => { const r = document.querySelector('#forms').getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY }; })()`);
  const phoneOff = [], phoneClocks = new Set();
  let phoneOn = 0, swiped = null;
  for (let y = top8.top - 422; y < top8.bottom; y += 380) {
    await phone8.evaluate(`scrollTo(0, ${Math.round(y)}), 1`);
    await wait(4200);
    const { st, off } = await sampleLive(phone8);
    phoneOff.push(...off); phoneClocks.add(st.clock); phoneOn = Math.max(phoneOn, st.blocks.filter(b => b.on).length);
    // a finger swiping on a block that plays: the page scrolls
    if (!swiped) {
      const at = await phone8.evaluate(`(() => { const f = document.querySelector('#forms .lv-live.on'); if (!f) return null; const r = f.closest('[data-live]').getBoundingClientRect(); return r.top > 60 && r.bottom < innerHeight - 20 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: f.closest('[data-live]').dataset.live } : null; })()`);
      if (at) {
        const from = await phone8.evaluate('scrollY');
        await phone8.send('Input.synthesizeScrollGesture', { x: at.x, y: at.y, yDistance: -260, gestureSourceType: 'touch', speed: 900 });
        await wait(500);
        swiped = { id: at.id, moved: Math.round(await phone8.evaluate('scrollY') - from) };
      }
    }
  }
  const phoneMax = await phone8.evaluate('window.__live');
  check(`390 × 844：从头滚过第五节，同时活着的 iframe 最多 ${phoneMax} 个（≤ 2），显示的都在时钟的那一帧（走过 ${phoneClocks.size} 轮）`, phoneMax <= 2 && phoneMax >= 1 && phoneOn >= 1 && !phoneOff.length && phoneClocks.size >= 3, { phoneMax, phoneOn, off: phoneOff, clocks: [...phoneClocks] });
  check('390 × 844：手指在播放中的块上滑动，滚动的是页面', Boolean(swiped) && swiped.moved >= 150, swiped);
  const phoneCover = await phone8.evaluate('window.__cover');
  check(`390 × 844：第五节在屏幕上的 ${phoneCover.frames} 帧里，每块底下都有静帧或占位，原型页面都在发来 shown 之后才显示`, coverOk(phoneCover), coverSay(phoneCover));
  check('390 × 844：第五节播放中没有报错', !phone8.problems.length, phone8.problems);
  await phone8.close();

  const calm = await open([390, 844], { reduced: true });
  await calm.evaluate(`(() => { const el = document.querySelector('#forms .lv-grid'); scrollTo(0, el.getBoundingClientRect().top + scrollY - 40); return 1; })()`);
  await wait(4000);
  const calmState = await calm.evaluate(`({ frames: document.querySelectorAll('iframe').length, stills: [...document.querySelectorAll('#forms [data-live] img')].filter(i => i.complete).map(i => i.currentSrc.split('/').pop()), at: [...new Set([...document.querySelectorAll('[data-live-at]')].map(e => e.textContent))] })`);
  const lastFrame = LIVE.frames.at(-1);
  check(`减弱动态：第五节不建 iframe、不播放，停在最后一帧（f${lastFrame} 的静帧，写“此刻”）`, calmState.frames === 0 && calmState.stills.length >= 1 && calmState.stills.every(f => f.endsWith(`-${lastFrame}.webp`)) && calmState.at.join() === '此刻', calmState);
  await calm.close();
} finally {
  socket.close();
  chrome.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await server?.close();
}

const failed = results.filter(ok => !ok).length;
console.log(failed ? `\n${failed} 项未通过。` : `\n全部 ${results.length} 项通过。`);
process.exit(failed ? 1 : 0);
