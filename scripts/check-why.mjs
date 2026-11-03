// /docs/why（为什么要做 Fold，docs/why.md）的自动检查：用本机无头 Chrome 打开构建好的站点，逐项核对：
// 1. 七个尺寸（375×667、390×844、430×932、820×1180、1180×820、1440×900、1920×1080）从头滚到底：没有报错、没有失败的请求、
//    没有横向滚动，所有图片都加载出来，七节都在、目录的每个链接都落到一个节名上；
// 2. 四种读法那张图：同一行的图一样高（第二行在手机上分成两行时不比）；
// 3. 节名与引句用的是 Fold Serif SC，而且字都在子集里（document.fonts 里那一款真的加载了）；
// 4. 旧地址 /docs/brief/、/docs/brief/index.html 跳到 /docs/why，旧的 #page-12 落到 #after-answer；
// 5. 导航里“从头读起”在入口页与这一页都链到 /docs/why。
//
//   npm run site:build && node scripts/check-why.mjs           # 自己起服务读 dist/
//   node scripts/check-why.mjs --base http://127.0.0.1:4174      # 或检查已在跑的站点
//   node scripts/check-why.mjs --shots .local/why-shots          # 顺带存七个尺寸的首屏与整页截图
//
// 只用 Node 22 内置的 WebSocket 驱动本机 Chrome（CHROME 可指定路径），不装依赖。任一项不过时退出码为 1。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  if (!existsSync(path.join(root, 'dist/docs/why.html'))) { console.error('dist/ 里还没有 docs/why.html：先运行 npm run site:build，或用 --base 指向在跑的站点。'); process.exit(1); }
  server = await serve(path.join(root, 'dist'));
}
const base = (option('--base') || server.url).replace(/\/$/, '');

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || detail === undefined ? '' : `\n    ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

// ---------- Chrome ----------
const profile = await mkdtemp(path.join(tmpdir(), 'fold-why-'));
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

async function open([width, height], url) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  const problems = [];
  const listen = m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') problems.push(`异常：${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`console.error：${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400 && !m.params.response.url.endsWith('/favicon.ico')) problems.push(`${m.params.response.status} ${m.params.response.url.replace(base, '')}`);
    if (m.method === 'Network.loadingFailed' && !m.params.canceled && m.params.errorText !== 'net::ERR_ABORTED') problems.push(`请求失败 ${m.params.errorText}`);
  };
  listeners.add(listen);
  const mobile = width <= 1180;
  await s('Runtime.enable'); await s('Page.enable'); await s('Network.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width < 960 ? 2 : 1, mobile });
  if (mobile) {
    await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await s('Emulation.setUserAgentOverride', { userAgent: width < 700 ? IPHONE : IPAD });
  }
  const evaluate = async expression => {
    const { result, exceptionDetails } = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  await s('Page.navigate', { url: `${base}${url}` });
  for (let i = 0; i < 100; i += 1) { if (await evaluate('document.readyState') === 'complete') break; await wait(100); }
  await evaluate('document.fonts.ready.then(() => 1)');
  return {
    problems, evaluate,
    async shot(file, full = false) {
      let clip;
      // Chrome repeats the page past 16 384 device pixels in one capture, so tall pages are captured scaled down.
      if (full) { const { cssContentSize: c } = await s('Page.getLayoutMetrics'); const dpr = width < 960 ? 2 : 1; clip = { x: 0, y: 0, width: Math.ceil(c.width), height: Math.ceil(c.height), scale: Math.min(1, 16000 / (Math.ceil(c.height) * dpr)) }; }
      const { data: png } = await s('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
      await writeFile(file, Buffer.from(png, 'base64'));
    },
    async close() { listeners.delete(listen); await send('Target.closeTarget', { targetId }); },
  };
}

// Scroll to the bottom a screen at a time so every lazy picture is asked for, then come back to the top.
const scrollThrough = `(async () => {
  const step = innerHeight * 0.8;
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
  scrollTo(0, document.documentElement.scrollHeight);
  await Promise.all([...document.images].map(img => img.complete ? 0 : new Promise(r => { img.onload = img.onerror = r; })));
  await new Promise(r => setTimeout(r, 200));
  scrollTo(0, 0);
  return 1; })()`;

const layout = `(() => {
  const doc = document.documentElement;
  const images = [...document.querySelectorAll('.fw img')].map(img => ({ src: img.getAttribute('src'), ok: img.complete && img.naturalWidth > 0, h: img.getBoundingClientRect().height, top: Math.round(img.getBoundingClientRect().top + scrollY) }));
  const rows = [...document.querySelectorAll('.fw-row')].map(row => {
    const by = new Map();
    for (const img of row.querySelectorAll('img')) { const r = img.getBoundingClientRect(); const k = Math.round(r.top + scrollY); by.set(k, [...(by.get(k) || []), r.height]); }
    return [...by.values()].map(hs => Math.max(...hs) - Math.min(...hs));
  }).flat();
  const ids = new Set([...document.querySelectorAll('.fw [id]')].map(e => e.id));
  const toc = [...document.querySelectorAll('.fw-toc a')].map(a => decodeURIComponent(a.hash.slice(1)));
  // Anything wider than the screen (the page itself, or a piece of it poking out to the right).
  const wide = [...document.querySelectorAll('.fw *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 0.5; }).slice(0, 5).map(e => e.className || e.tagName);
  const serif = [...document.querySelectorAll('.fw h1, .fw h2, .fw blockquote p')].map(e => getComputedStyle(e).fontFamily.split(',')[0].replace(/"/g, '').trim());
  return { scrollWidth: doc.scrollWidth, innerWidth, wide, images, rows, sections: document.querySelectorAll('.fw-sec').length, toc, missing: toc.filter(id => !ids.has(id)), serif,
    navLink: [...document.querySelectorAll('.VPNav a')].some(a => a.textContent.trim() === '从头读起' && a.getAttribute('href') === '/docs/why') };
})()`;

// Every character set in the serif here, against the faces the browser actually loaded for it.
const fontState = `(async () => {
  // (the heading anchors VitePress adds hold a zero-width space)
  const text = [...document.querySelectorAll('.fw h1, .fw h2, .fw blockquote p, .fw-toc a')].map(e => e.textContent.replace(/\u200b/g, '')).join('');
  await document.fonts.load('700 24px "Fold Serif SC"', text);
  const faces = [...document.fonts].filter(f => f.family.replace(/"/g, '') === 'Fold Serif SC');
  const inRange = (range, c) => range.split(',').some(part => { const [a, b] = part.trim().replace(/^U\\+/i, '').split('-').map(x => parseInt(x, 16)); const p = c.codePointAt(0); return p >= a && p <= (b ?? a); });
  const missing = [...new Set(text)].filter(c => c.trim() && !faces.some(f => inRange(f.unicodeRange, c)));
  return { missing: missing.join(''), loaded: faces.filter(f => f.status === 'loaded').length };
})()`;

try {
  if (shots) await mkdir(shots, { recursive: true });
  // ---- 1–3. seven sizes ----
  for (const size of SIZES) {
    const [w, h] = size;
    const page = await open(size, '/docs/why');
    await wait(300);
    if (shots) await page.shot(path.join(shots, `${w}x${h}-first.png`));
    await page.evaluate(scrollThrough);
    const l = await page.evaluate(layout);
    const bad = l.images.filter(i => !i.ok).map(i => i.src);
    const tall = l.rows.filter(d => d > 1.5);
    check(`${w}×${h}：没有报错与失败的请求`, !page.problems.length, page.problems.slice(0, 5).join('；'));
    check(`${w}×${h}：没有横向滚动（页面 ${l.scrollWidth} ≤ 屏宽 ${l.innerWidth}，没有伸出右边的元素）`, l.scrollWidth <= l.innerWidth && !l.wide.length, l.wide.join('、'));
    check(`${w}×${h}：${l.images.length} 张图都加载出来`, l.images.length === 4 && !bad.length, bad.join('、') || `只有 ${l.images.length} 张`);
    check(`${w}×${h}：七节都在，目录 ${l.toc.length} 个链接都落到节名上`, l.sections === 7 && l.toc.length === 7 && !l.missing.length, l.missing.join('、'));
    check(`${w}×${h}：四种读法同一行的图一样高`, !tall.length, `高差 ${tall.map(d => d.toFixed(1)).join('、')} px`);
    check(`${w}×${h}：标题与引句用 Fold Serif SC`, l.serif.length >= 9 && l.serif.every(f => f === 'Fold Serif SC'), [...new Set(l.serif)].join('、'));
    if (size === SIZES[1]) {
      const f = await page.evaluate(fontState);
      check(`标题与引句的字都在 Fold Serif SC 子集里（已加载 ${f.loaded} 款）`, !f.missing && f.loaded > 0, `不在子集里：${f.missing}`);
    }
    if (size === SIZES[5]) check('导航“从头读起”链到 /docs/why（这一页）', l.navLink);
    if (shots) await page.shot(path.join(shots, `${w}x${h}-full.png`), true);
    await page.close();
  }

  // ---- 4. the old addresses ----
  for (const [from, to] of [['/docs/brief/', '/docs/why'], ['/docs/brief/index.html', '/docs/why'], ['/docs/brief/index.html#page-12', '/docs/why#after-answer']]) {
    const page = await open([390, 844], from);
    let at = '';
    for (let i = 0; i < 40; i += 1) { at = await page.evaluate('location.pathname + location.hash').catch(() => ''); if (at.startsWith('/docs/why')) break; await wait(100); }
    await wait(200);
    at = await page.evaluate('location.pathname + location.hash');
    const title = await page.evaluate(`document.querySelector('.fw h1')?.textContent.replace(/\\u200b/g, '').trim() || ''`);
    check(`旧地址 ${from} 跳到 ${to}`, at === to && title === '为什么要做 Fold', `落在 ${at}，标题「${title}」`);
    await page.close();
  }

  // ---- 5. the landing's nav ----
  const landing = await open([1440, 900], '/');
  const link = await landing.evaluate(`[...document.querySelectorAll('.VPNav a')].some(a => a.textContent.trim() === '从头读起' && a.getAttribute('href') === '/docs/why')`);
  check('入口页导航“从头读起”链到 /docs/why', link);
  await landing.close();
} finally {
  socket.close();
  chrome.kill();
  await server?.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter(ok => !ok).length;
console.log(failed ? `\n${failed} 项没有通过。` : `\n全部 ${results.length} 项通过。`);
process.exit(failed ? 1 : 0);
