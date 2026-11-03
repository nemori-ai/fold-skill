// /legacy/（2026-11-03 换版前的旧站，scripts/legacy-site.mjs 构建）的自动检查。默认用 wrangler dev --local 服务 dist/
// （与线上同一套 html_handling 与 404 页处理），本机无头 Chrome 逐页打开，核对：
// 1. dist/legacy/ 下的每一个 HTML 页面，再加原型画册里每张卡的地址（原版与 A–E 带 ?variant=，形式页带 ?frame=）：
//    从头滚到底，记录全部网络请求。同站请求落在 /legacy/ 之外、任何 4xx/5xx（404 页本身那一次除外）、请求失败、
//    控制台报错与页面异常，都算失败；跨域请求按主机列出；页面没声明图标时浏览器自己去要的 /favicon.ico 单列，不算失败；
// 2. 页面上的链接与 iframe：同站的都在 /legacy/ 下（普通页面右上角的“新版”除外，它指向 /），并且逐个请求一遍，
//    跳转不出 /legacy/、最终 200；
// 3. 普通页面（VitePress 文档页、首页、404）都有 noindex 和一个“新版”链接；原型页两样都没有；
// 4. 交互：导航、侧栏、正文链接、下一篇、后退、站名走 VitePress 客户端路由（页面不重新载入）并留在 /legacy/；
//    导航的原型画册面板与首页画册的卡片在弹框里打开原型，“新标签页打开”也指向 /legacy/；站内搜索一次并点进结果；
//    手机宽度从菜单打开画册再开一个原型；
// 5. 带 --compare <站点> 时，与那个站点的对应页面逐页截图对比（换版前的 https://fold.vibecoding.icu/ 就是旧站），
//    两边的截图与差异图写到 --shots 目录（默认 .local/legacy-compare/），并报告差异像素占比与所在范围。两边都减弱动态、
//    每个请求加同样的延迟；只许导航栏那一行不同（“新版”和给它让位的导航项）。
//
//   npm run site:build && node scripts/check-legacy.mjs
//   node scripts/check-legacy.mjs --base http://127.0.0.1:4174       # 检查已在跑的站点（npm run site:preview）
//   node scripts/check-legacy.mjs --compare https://fold.vibecoding.icu --shots .local/legacy-compare
//   node scripts/check-legacy.mjs --only compare --compare https://fold.vibecoding.icu   # 只做截图对比（pages、interactions 同理）
//   node scripts/check-legacy.mjs --only compare --compare https://fold.vibecoding.icu --cases home,proto-d   # 只比这几页
//
// 只用 Node 22 内置能力驱动本机 Chrome（CHROME 可指定路径），不装依赖。任一项不过时退出码为 1。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const LEGACY = '/legacy/';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const compareWith = option('--compare')?.replace(/\/$/, '') || null;
const shots = path.resolve(root, option('--shots') || '.local/legacy-compare');
const parts = new Set((option('--only') || `pages,interactions${compareWith ? ',compare' : ''}`).split(','));
const JOBS = Number(option('--jobs') || 4);

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || detail === undefined ? '' : `\n    ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

// ---------- 本机服务：wrangler dev --local 服务 dist/ ----------
const freePort = () => new Promise((done, fail) => {
  const probe = createServer();
  probe.on('error', fail);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)); });
});
let wrangler = null, state = null;
let base = option('--base')?.replace(/\/$/, '');
const stopWrangler = async () => {
  if (wrangler) try { process.kill(-wrangler.pid, 'SIGTERM'); } catch {}
  if (state) { await wait(300); await rm(state, { recursive: true, force: true }).catch(() => {}); }
};
if (!base) {
  if (!existsSync(path.join(root, 'dist/legacy/index.html'))) { console.error('dist/legacy/ 还没有构建：先运行 npm run site:build，或用 --base 指向在跑的站点。'); process.exit(1); }
  const port = await freePort(), inspector = await freePort();
  // Its own state directory: two wrangler dev at once (say npm run site:preview) would otherwise lock each other's.
  state = await mkdtemp(path.join(tmpdir(), 'fold-legacy-wrangler-'));
  wrangler = spawn(path.join(root, 'node_modules/.bin/wrangler'),
    ['dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspector), '--persist-to', state, '--show-interactive-dev-session=false', '--log-level', 'warn'],
    { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  let log = '';
  wrangler.stdout.on('data', chunk => { log += chunk; });
  wrangler.stderr.on('data', chunk => { log += chunk; });
  base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 120 && !up; i += 1) { try { up = (await fetch(`${base}${LEGACY}`)).ok; } catch {} if (!up) await wait(500); }
  if (!up) { console.error(`wrangler dev 没有起来：\n${log}`); await stopWrangler(); process.exit(1); }
  console.log(`wrangler dev --local 服务 dist/：${base}`);
}
const origin = new URL(base).origin;

// ---------- Chrome ----------
const profile = await mkdtemp(path.join(tmpdir(), 'fold-legacy-'));
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
// Interrupted (Ctrl-C), the server and the browser go too.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { chrome.kill(); await stopWrangler(); process.exit(130); });
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

// A page that declares no icon makes the browser itself ask the site root for /favicon.ico (as it did on the live site
// before the switch). That request is not the page's; it is counted apart, not as a failure.
const browserFavicon = (url, type) => type === 'Other' && /^https?:\/\/[^/]+\/favicon\.ico$/.test(url);

// One tab: every request it makes (its same-origin iframes included), what failed, and what the console said.
async function open(url, { width = 1440, height = 900, mobile = false, expect404 = false, reduceMotion = false, latency = 0 } = {}) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  const tab = { url, requests: [], problems: [], inflight: new Set(), last: Date.now(), urls: new Map() };
  const listen = m => {
    if (m.sessionId !== sessionId) return;
    const p = m.params;
    if (m.method === 'Network.requestWillBeSent') {
      tab.inflight.add(p.requestId); tab.last = Date.now(); tab.urls.set(p.requestId, p.request.url);
      tab.requests.push({ url: p.request.url, type: p.type, from: p.redirectResponse ? p.redirectResponse.url : null });
    } else if (m.method === 'Network.responseReceived') {
      const { status, url: at } = p.response;
      if (status >= 400 && !(expect404 && p.type === 'Document' && status === 404) && !browserFavicon(at, p.type)) tab.problems.push(`${status} ${at}`);
    } else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') {
      tab.inflight.delete(p.requestId); tab.last = Date.now();
      // ERR_ABORTED: a frame unloaded on purpose (the combined page drops sections that scroll away).
      if (m.method === 'Network.loadingFailed' && !p.canceled && p.errorText !== 'net::ERR_ABORTED') tab.problems.push(`请求失败 ${p.errorText} ${tab.urls.get(p.requestId)}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      tab.problems.push(`异常：${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) {
      tab.problems.push(`console.${p.type}：${p.args.map(a => a.value ?? a.description).join(' ')}`);
    } else if (m.method === 'Log.entryAdded' && p.entry.level === 'error') {
      if (!(expect404 && p.entry.source === 'network' && p.entry.url === url) && !(p.entry.source === 'network' && browserFavicon(p.entry.url || '', 'Other'))) tab.problems.push(`${p.entry.source}：${p.entry.text} ${p.entry.url || ''}`.trim());
    }
  };
  listeners.add(listen);
  await s('Runtime.enable'); await s('Page.enable'); await s('Network.enable'); await s('Log.enable');
  await s('Emulation.setFocusEmulationEnabled', { enabled: true });
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  if (mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (reduceMotion) await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  if (latency) await s('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: -1, uploadThroughput: -1 });
  const evaluate = async expression => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const { result, exceptionDetails } = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
        return result.value;
      } catch (error) {
        // a navigation in progress destroys the context the expression ran in
        if (attempt < 20 && /context|navigat|Cannot find/i.test(error.message)) { await wait(100); continue; }
        throw error;
      }
    }
  };
  // Quiet: nothing in flight for a while (or give up after `max`).
  const settle = async (quiet = 600, max = 12000) => {
    const start = Date.now();
    while (Date.now() - start < max) { if (!tab.inflight.size && Date.now() - tab.last > quiet) return; await wait(100); }
  };
  const until = async (expression, max = 10000) => {
    const start = Date.now();
    while (Date.now() - start < max) { if (await evaluate(expression).catch(() => false)) return true; await wait(100); }
    return false;
  };
  await s('Page.navigate', { url });
  await until(`document.readyState === 'complete'`, 20000);
  await evaluate('document.fonts.ready.then(() => 1)');
  await settle();
  Object.assign(tab, {
    s, evaluate, settle, until,
    async shot(file, full = false) {
      let clip;
      if (full) {
        const { cssContentSize: c } = await s('Page.getLayoutMetrics');
        clip = { x: 0, y: 0, width: Math.ceil(c.width), height: Math.min(16000, Math.ceil(c.height)), scale: 1 };
      }
      const { data } = await s('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
      if (file) await writeFile(file, Buffer.from(data, 'base64'));
      return data;
    },
    async close() { listeners.delete(listen); await send('Target.closeTarget', { targetId }); },
  });
  return tab;
}

// Scroll the page (or a scrolling box in it) to the bottom a screen at a time so lazy pictures and iframes are asked for,
// then come back to the top.
const scrollThrough = (box = null) => `(async () => {
  const box = ${box ? `document.querySelector(${JSON.stringify(box)})` : 'document.scrollingElement'};
  const step = (box.clientHeight || innerHeight) * 0.8;
  for (let y = 0, n = 0; y < box.scrollHeight && n < 80; y += step, n += 1) { box.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
  box.scrollTo(0, box.scrollHeight);
  await Promise.all([...document.images].map(img => img.complete ? 0 : new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 5000); })));
  await new Promise(r => setTimeout(r, 200));
  box.scrollTo(0, 0);
  return 1; })()`;

// What a page links to: anchors and iframes in the page and in its same-origin frames.
const inventory = `(() => {
  const docs = [document];
  for (let i = 0; i < docs.length; i += 1) for (const f of docs[i].querySelectorAll('iframe')) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch {} }
  const href = (a, d) => { const v = typeof a.href === 'string' ? a.getAttribute('href') : a.href.baseVal; return v == null ? null : new URL(v, d.baseURI).href; };
  const links = [];
  for (const d of docs) {
    for (const a of d.querySelectorAll('a[href], area[href]')) links.push({ href: href(a, d), newer: a.classList.contains('fold-legacy-new'), text: a.textContent.trim().slice(0, 40) });
    for (const f of d.querySelectorAll('iframe[src]')) links.push({ href: new URL(f.getAttribute('src'), d.baseURI).href, frame: true });
  }
  return {
    links,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') || null,
    newer: [...document.querySelectorAll('a.fold-legacy-new')].map(a => a.getAttribute('href')),
    vitepress: Boolean(document.querySelector('#app .Layout')),
    icon: Boolean(document.querySelector('link[rel~="icon"]')),
    at: location.href.replace(/#.*$/, ''),
    title: document.title,
    heading: (document.querySelector('.NotFound .title, h1')?.textContent || '').trim(),
  };
})()`;

// Same-origin requests and links must stay under /legacy/; everything else is listed by host.
const inside = url => { const u = new URL(url); return u.origin !== origin || u.pathname.startsWith(LEGACY); };
const skipScheme = url => /^(?:data|blob|about|javascript|mailto|chrome[\w-]*):/i.test(url);

const crossHosts = new Map();
let requestCount = 0, sameOriginCount = 0, faviconRequests = 0;
const failures = [];
function account(tab, label) {
  for (const r of tab.requests) {
    if (skipScheme(r.url)) continue;
    requestCount += 1;
    const u = new URL(r.url);
    if (u.origin === origin) {
      sameOriginCount += 1;
      if (browserFavicon(r.url, r.type)) { faviconRequests += 1; continue; }
      if (!u.pathname.startsWith(LEGACY)) failures.push(`${label}：同站请求跳出 ${LEGACY}：${u.pathname}${u.search}${r.from ? `（由 ${new URL(r.from).pathname} 跳转）` : ''}`);
    } else crossHosts.set(u.host, (crossHosts.get(u.host) || 0) + 1);
  }
  for (const p of tab.problems) failures.push(`${label}：${p}`);
}

// ---------- 1–3. every page ----------
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(path.relative(path.join(root, 'dist/legacy'), full).split(path.sep).join('/'));
  }
  return files;
}

// The address a page is linked by: VitePress pages without .html (cleanUrls), index pages as their folder,
// prototype pages with .html as the site links them (the server then drops the extension).
function address(file) {
  if (file === '404.html') return { url: `${LEGACY}no-such-page`, kind: '404', expect404: true };
  if (file === 'index.html' || file.endsWith('/index.html')) return { url: `${LEGACY}${file.slice(0, -'index.html'.length)}`, kind: file.startsWith('prototype/') ? 'prototype' : file.startsWith('docs/brief/') ? 'brief' : 'vitepress' };
  if (file.startsWith('prototype/')) return { url: `${LEGACY}${file}`, kind: 'prototype' };
  return { url: `${LEGACY}${file.replace(/\.html$/, '')}`, kind: 'vitepress' };
}

const linkTargets = new Map();   // same-origin URL without hash → first page linking it
const outside = [];
async function visit(page) {
  const tab = await open(`${base}${page.url}`, { expect404: page.expect404 });
  try {
    await tab.evaluate(scrollThrough());
    await tab.settle();
    const inv = await tab.evaluate(inventory);
    account(tab, page.url);
    for (const link of inv.links) {
      if (!link.href || skipScheme(link.href)) continue;
      const u = new URL(link.href);
      if (u.origin !== origin) continue;
      if (link.newer) continue;
      if (link.href.replace(/#.*$/, '') === inv.at) continue;   // an anchor on the page itself
      if (!u.pathname.startsWith(LEGACY)) { outside.push(`${page.url}：${link.frame ? 'iframe' : '链接'}「${link.text || ''}」→ ${u.pathname}${u.search}`); continue; }
      const key = `${u.origin}${u.pathname}${u.search}`;
      if (!linkTargets.has(key)) linkTargets.set(key, page.url);
    }
    return { ...page, robots: inv.robots, newer: inv.newer, vitepress: inv.vitepress, icon: inv.icon, title: inv.title, heading: inv.heading, cards: page.url === LEGACY ? inv.links.filter(l => !l.frame && /\/legacy\/prototype\//.test(l.href) && l.href.startsWith(origin)) : null };
  } finally { await tab.close(); }
}

async function pool(items, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(JOBS, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await worker(items[i]).catch(error => ({ ...items[i], error: error.message })); }
  }));
  return out;
}

try {
  if (parts.has('pages')) {
    const files = (await walk(path.join(root, 'dist/legacy'))).sort();
    const pages = files.map(file => ({ file, ...address(file) }));
    const started = Date.now();
    const visited = await pool(pages, visit);
    // The gallery's cards: the desks with ?variant=, the forms at their default frame, as the home page links them.
    const home = visited.find(p => p.url === LEGACY);
    const seen = new Set(pages.map(p => `${origin}${p.url}`));
    const cards = [...new Set((home?.cards || []).map(l => l.href))].filter(href => !seen.has(href))
      .map(href => ({ file: null, url: href.slice(origin.length), kind: 'card' }));
    visited.push(...await pool(cards, visit));
    for (const p of visited) if (p.error) failures.push(`${p.url}：检查中断：${p.error}`);

    const count = kind => visited.filter(p => p.kind === kind).length;
    console.log(`打开 ${visited.length} 个页面（${files.length} 个 HTML 文件：VitePress 页面 ${count('vitepress')}、原型 ${count('prototype')}、小册子 ${count('brief')}、404 页 ${count('404')}；另加画册卡片的地址 ${count('card')} 个），用时 ${((Date.now() - started) / 1000).toFixed(0)} s。`);
    console.log(`请求 ${requestCount} 次：同站 ${sameOriginCount}，跨域 ${requestCount - sameOriginCount}${crossHosts.size ? `（${[...crossHosts].map(([h, n]) => `${h} ${n}`).join('、')}）` : ''}。`);
    const iconless = visited.filter(p => p.icon === false);
    if (iconless.length) console.log(`另：${iconless.length} 个页面没有声明图标（${[...new Set(iconless.map(p => p.kind))].join('、')}，与换版前一样），浏览器会自己去站点根目录要 /favicon.ico；同一个浏览器只要一次，这次要了 ${faviconRequests} 次，单列，不算失败。`);
    check(`每页从头滚到底：同站请求都在 ${LEGACY} 下，没有 4xx/5xx、失败的请求、控制台报错与页面异常`, !failures.length, `${failures.length} 处：\n    ${[...new Set(failures)].slice(0, 30).join('\n    ')}`);

    // ---- 2. links ----
    check(`页面上的链接与 iframe：同站的都在 ${LEGACY} 下（“新版”除外）`, !outside.length, `${outside.length} 处：\n    ${[...new Set(outside)].slice(0, 30).join('\n    ')}`);
    const broken = [];
    await pool([...linkTargets.keys()], async url => {
      let at = url;
      for (let hop = 0; hop < 6; hop += 1) {
        const response = await fetch(at, { redirect: 'manual' });
        await response.arrayBuffer();
        if (response.status >= 300 && response.status < 400) {
          const next = new URL(response.headers.get('location'), at).href;
          if (!inside(next)) { broken.push(`${url.slice(origin.length)} 跳到 ${next}（${linkTargets.get(url)} 上的链接）`); return; }
          at = next;
          continue;
        }
        if (response.status !== 200) broken.push(`${response.status} ${url.slice(origin.length)}（${linkTargets.get(url)} 上的链接）`);
        return;
      }
      broken.push(`跳转太多次 ${url.slice(origin.length)}`);
    });
    check(`链接与 iframe 指向的 ${linkTargets.size} 个同站地址逐个请求：跳转不出 ${LEGACY}，最终都是 200`, !broken.length, broken.slice(0, 30).join('\n    '));

    // ---- 3. noindex and the link to the new site ----
    const ordinary = visited.filter(p => p.kind === 'vitepress' || p.kind === '404');
    const badOrdinary = ordinary.filter(p => p.robots !== 'noindex' || p.newer?.length !== 1 || p.newer[0] !== '/' || !p.vitepress);
    check(`普通页面（${ordinary.length} 个 VitePress 页面，含首页与 404）都有 noindex，右上角一个“新版”指向 /`, ordinary.length > 0 && !badOrdinary.length, badOrdinary.map(p => `${p.url}（robots=${p.robots}，新版=${JSON.stringify(p.newer)}）`).slice(0, 10).join('、'));
    const protos = visited.filter(p => p.kind === 'prototype' || p.kind === 'card');
    const badProto = protos.filter(p => p.robots || p.newer?.length);
    check(`原型页（${protos.length} 个地址）没有加东西：没有 noindex、没有“新版”`, !badProto.length, badProto.map(p => p.url).slice(0, 10).join('、'));
    const brief = visited.find(p => p.kind === 'brief');
    check('小册子（静态 HTML）有 noindex，页面本身没加链接', brief && brief.robots === 'noindex' && !brief.newer?.length, brief && `robots=${brief.robots}`);
    const notFound = visited.find(p => p.kind === '404');
    check(`不存在的地址 ${notFound?.url} 落到旧站自己的 404 页（“${notFound?.heading}”）`, Boolean(notFound?.vitepress && notFound.heading === '页面不存在'), notFound);
  }

  // ---------- 4. interactions ----------
  if (parts.has('interactions')) {
    const before = failures.length;
    const tab = await open(`${base}${LEGACY}`);
    const stay = `window.__legacyStay === 1`;
    await tab.evaluate('window.__legacyStay = 1');
    const at = () => tab.evaluate('location.pathname + location.search');
    // A step that cannot even be carried out (an element missing because the page went elsewhere) fails, not crashes.
    const guarded = async (name, fn) => { try { await fn(); } catch (error) { check(name, false, error.message.split('\n')[0]); } };
    // Click something, wait for the page to show what it should, and confirm VitePress routed it (no reload) inside /legacy/.
    const step = (name, click, ready) => guarded(name, async () => {
      const target = await tab.evaluate(click);
      const ok = await tab.until(ready);
      await tab.settle(400, 6000);
      const where = await at();
      const kept = await tab.evaluate(stay).catch(() => false);
      check(`${name}${target ? `（${target}）` : ''} → ${where}`, ok && kept && where.startsWith(LEGACY), `${ok ? '' : '没等到页面就绪；'}${kept ? '' : '页面重新载入了；'}停在 ${where}`);
    });
    const nav = text => `(() => { const a = [...document.querySelectorAll('.VPNavBarMenuLink')].find(a => a.textContent.trim() === ${JSON.stringify(text)}); a.click(); return a.getAttribute('href'); })()`;
    await step('导航“概览”', nav('概览'), `location.pathname === '${LEGACY}overview' && !!document.querySelector('.vp-doc h1')`);
    await step('侧栏“产品方向”', `(() => { const a = [...document.querySelectorAll('.VPSidebarItem a')].find(a => a.textContent.trim() === '产品方向'); a.click(); return a.getAttribute('href'); })()`,
      `location.pathname === '${LEGACY}docs/product' && /产品/.test(document.querySelector('.vp-doc h1')?.textContent || '')`);
    await tab.evaluate(`window.__next = [...document.querySelectorAll('.vp-doc a[href^="${LEGACY}docs/"]:not([target])')].find(a => a.pathname !== location.pathname)?.pathname || null`);
    await step('正文里的链接', `(() => { const a = [...document.querySelectorAll('.vp-doc a[href^="${LEGACY}docs/"]:not([target])')].find(a => a.pathname !== location.pathname); a.click(); return a.getAttribute('href'); })()`,
      `location.pathname === window.__next && !!document.querySelector('.vp-doc h1')`);
    await tab.evaluate(`window.__next = document.querySelector('.pager-link.next')?.pathname || null`);
    await step('下一篇', `(() => { const a = document.querySelector('.pager-link.next'); a.click(); return a.getAttribute('href'); })()`, `location.pathname === window.__next`);
    await step('浏览器后退', `(history.back(), 'history.back()')`, `location.pathname !== window.__next`);
    await step('站名回首页', `(() => { const a = document.querySelector('.VPNavBarTitle a.title'); a.click(); return a.getAttribute('href'); })()`, `location.pathname === '${LEGACY}' && !!document.querySelector('.fold-home')`);

    // The prototype gallery in the nav: its cards, its combined-page link, and a prototype opened in the viewer.
    await guarded('导航的原型画册', async () => {
      await tab.evaluate(`document.querySelector('.fold-menu-bar').click()`);
      await tab.until(`getComputedStyle(document.getElementById('fold-prototype-panel')).display !== 'none' && document.querySelectorAll('#fold-prototype-panel .fold-gallery-card').length > 20`);
      await tab.evaluate(scrollThrough('#fold-prototype-panel'));
      await tab.settle();
      const panel = await tab.evaluate(`(() => { const p = document.getElementById('fold-prototype-panel');
        return { cards: [...p.querySelectorAll('.fold-gallery-card')].map(a => a.getAttribute('href')), images: [...p.querySelectorAll('.fold-gallery-card img')].map(i => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })),
          combined: p.querySelector('.fold-panel-link')?.getAttribute('href') }; })()`);
      const badCards = panel.cards.filter(h => !h.startsWith(`${LEGACY}prototype/`));
      const badImages = panel.images.filter(i => !i.src.startsWith(`${LEGACY}previews/`) || !i.ok);
      check(`导航的原型画册：${panel.cards.length} 张卡都链到 ${LEGACY}prototype/，预览图都从 ${LEGACY}previews/ 载入，合页链到 ${panel.combined}`,
        panel.cards.length > 20 && !badCards.length && !badImages.length && panel.combined === `${LEGACY}prototype/all.html`, [...badCards, ...badImages.map(i => i.src)].slice(0, 10).join('、'));
    });
    const viewer = (name, click) => guarded(`${name}在弹框里打开`, async () => {
      const card = await tab.evaluate(click);
      const loaded = await tab.until(`!!document.querySelector('.fold-viewer[open] .fold-viewer-stage.is-loaded iframe')`, 20000);
      await tab.settle(600, 10000);
      const state = await tab.evaluate(`(() => { const f = document.querySelector('.fold-viewer[open] iframe'); const a = document.querySelector('.fold-viewer-open');
        a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click();
        let inner = null; try { inner = f.contentWindow.location.pathname + f.contentWindow.location.search; } catch {}
        return { src: f.getAttribute('src'), inner, tab: a.getAttribute('href'), page: location.pathname }; })()`);
      check(`${name}在弹框里打开（${card}）：iframe ${state.inner}，“新标签页打开”${state.tab}`,
        loaded && state.src.startsWith(`${LEGACY}prototype/`) && state.inner?.startsWith(`${LEGACY}prototype/`) && state.tab.startsWith(`${LEGACY}prototype/`) && !/embed=|card=/.test(state.tab) && state.page.startsWith(LEGACY), state);
      await tab.evaluate(`document.querySelector('.fold-viewer-bar button[aria-label="关闭"]').click()`);
      check(`${name}的弹框关得上`, await tab.until(`!document.querySelector('.fold-viewer[open]')`));
      // The dialog's close event arrives a task later and clears whatever is open then: let it pass before the next card.
      await wait(600);
    });
    await viewer('导航画册里的“D 手机首页”', `(() => { const a = [...document.querySelectorAll('#fold-prototype-panel .fold-gallery-card')].find(a => a.textContent.includes('D 手机首页')); a.click(); return a.getAttribute('href'); })()`);
    await tab.evaluate(`document.querySelector('.fold-menu-bar').getAttribute('aria-expanded') === 'true' && document.querySelector('.fold-menu-bar').click()`);
    await tab.until(`getComputedStyle(document.getElementById('fold-prototype-panel')).display === 'none'`);
    await viewer('首页画册里的“腕上”', `(() => { const a = [...document.querySelectorAll('.fold-home .fold-gallery-card')].find(a => a.getAttribute('href').includes('/forms/watch.html')); a.click(); return a.getAttribute('href'); })()`);

    // Search once and follow the first result.
    await guarded('站内搜索', async () => {
      await tab.evaluate(`document.querySelector('.DocSearch-Button').click()`);
      await tab.until(`!!document.querySelector('.VPLocalSearchBox .search-input')`);
      await tab.evaluate(`(() => { const i = document.querySelector('.VPLocalSearchBox .search-input'); i.value = '份额'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const found = await tab.until(`document.querySelectorAll('.VPLocalSearchBox .result').length > 0`);
      const hits = await tab.evaluate(`[...document.querySelectorAll('.VPLocalSearchBox .result')].map(a => a.getAttribute('href'))`);
      check(`站内搜索“份额”：${hits.length} 条结果都在 ${LEGACY} 下`, found && hits.length > 0 && hits.every(h => h.startsWith(LEGACY)), hits.filter(h => !h.startsWith(LEGACY)).slice(0, 5));
      await tab.evaluate(`window.__hit = new URL(document.querySelector('.VPLocalSearchBox .result').href).pathname`);
    });
    await step('点进第一条搜索结果', `(() => { const a = document.querySelector('.VPLocalSearchBox .result'); a.click(); return a.getAttribute('href'); })()`,
      `!document.querySelector('.VPLocalSearchBox') && location.pathname === window.__hit`);
    account(tab, '交互（1440×900）');
    await tab.close();

    // Phone width: the gallery opens from the menu as a full-screen sheet.
    const phone = await open(`${base}${LEGACY}docs/product`, { width: 390, height: 844, mobile: true });
    await guarded('手机宽度（390×844）从菜单打开画册', async () => {
      await phone.evaluate(`document.querySelector('.VPNavBarHamburger').click()`);
      await phone.until(`!!document.querySelector('.VPNavScreen .fold-menu-screen')`);
      await phone.evaluate(`document.querySelector('.VPNavScreen .fold-menu-screen').click()`);
      await phone.until(`getComputedStyle(document.getElementById('fold-prototype-panel')).display !== 'none'`);
      await phone.evaluate(`[...document.querySelectorAll('#fold-prototype-panel .fold-gallery-card')].find(a => a.textContent.includes('E 折叠屏')).click()`);
      const opened = await phone.until(`!!document.querySelector('.fold-viewer[open] .fold-viewer-stage.is-loaded iframe')`, 20000);
      await phone.settle(600, 10000);
      const inner = await phone.evaluate(`(() => { try { return document.querySelector('.fold-viewer[open] iframe').contentWindow.location.pathname + document.querySelector('.fold-viewer[open] iframe').contentWindow.location.search; } catch { return null; } })()`);
      const newer = await phone.evaluate(`[...document.querySelectorAll('a.fold-legacy-new')].filter(a => a.getBoundingClientRect().width > 0).length`);
      check(`手机宽度（390×844）：“新版”在导航栏里看得见，从菜单打开画册、在弹框里开“E 折叠屏”：iframe ${inner}`, opened && newer === 1 && inner?.startsWith(`${LEGACY}prototype/`), { opened, newer, inner });
    });
    account(phone, '交互（390×844）');
    await phone.close();
    const added = failures.slice(before);
    check(`交互过程中的请求都在 ${LEGACY} 下，没有报错`, !added.length, [...new Set(added)].slice(0, 20).join('\n    '));
  }

  // ---------- 5. screenshots against another site ----------
  if (parts.has('compare') && compareWith) {
    await mkdir(shots, { recursive: true });
    const openPanelCard = text => `(async () => { document.querySelector('.fold-menu-bar').click(); await new Promise(r => setTimeout(r, 400));
      [...document.querySelectorAll('#fold-prototype-panel .fold-gallery-card')].find(a => a.textContent.includes(${JSON.stringify(text)})).click(); return 1; })()`;
    const CASES = [
      { name: 'home', path: '/', full: true },
      { name: 'overview', path: '/overview', full: true },
      { name: 'docs-product', path: '/docs/product', full: true },
      { name: 'docs-information-contract', path: '/docs/information-contract', full: true },
      { name: 'gallery-panel', path: '/docs/product', action: `(async () => { document.querySelector('.fold-menu-bar').click(); await new Promise(r => setTimeout(r, 600)); return 1; })()`, ready: `[...document.querySelectorAll('#fold-prototype-panel img')].every(i => i.complete && i.naturalWidth > 0)` },
      { name: 'gallery-dialog-d', path: '/', action: openPanelCard('D 手机首页'), ready: `!!document.querySelector('.fold-viewer-stage.is-loaded')`, pause: 2500 },
      { name: 'gallery-dialog-watch', path: '/docs/product', action: openPanelCard('腕上'), ready: `!!document.querySelector('.fold-viewer-stage.is-loaded')`, pause: 2500 },
      { name: 'proto-d', path: '/prototype/?variant=d&frame=26', pause: 1500 },
      { name: 'proto-watch', path: '/prototype/forms/watch.html?frame=26', pause: 1500 },
      { name: 'proto-multiples', path: '/prototype/forms/multiples.html?frame=26', pause: 1500 },
      { name: 'proto-original', path: '/prototype/?frame=26', pause: 1500 },
    ];
    // Both sides get the same added latency. The original desk (prototype/app.mjs fitTile) fits each tile's text when it
    // first renders, so how crowded one small tile comes out depends on load timing: served from this machine with no
    // delay it trims one tile harder than the live site does, at the site root just as under /legacy/. With a delay
    // like the live site's, the two come out the same.
    const LATENCY = 300;
    // The difference of two screenshots, drawn in a blank tab: changed pixels in red over a faded copy. A pixel counts as
    // changed when a colour channel differs by more than 64 and nothing within one pixel of it on the other side is close
    // (in both directions). The gallery's previews, scaled down, come out a little differently from one capture of the
    // same page to the next (up to about 50 in one channel at saturated edges); changed text and layout differ by far more.
    const differ = await open('about:blank');
    async function diff(a, b) {
      return differ.evaluate(`(async () => {
        const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
        const [a, b] = await Promise.all([load('data:image/png;base64,${a}'), load('data:image/png;base64,${b}')]);
        const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
        const pixels = img => { const c = new OffscreenCanvas(w, h).getContext('2d'); c.drawImage(img, 0, 0); return c.getImageData(0, 0, w, h).data; };
        const pa = pixels(a), pb = pixels(b);
        const out = new OffscreenCanvas(w, h), ctx = out.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
        let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1, m = 0, u0 = w, v0 = h, u1 = -1, v1 = -1;
        const DELTA = 64;
        const near = (p, q, i, x, y) => {
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = (yy * w + xx) * 4;
            if (Math.max(Math.abs(p[i] - q[j]), Math.abs(p[i + 1] - q[j + 1]), Math.abs(p[i + 2] - q[j + 2])) <= DELTA) return true;
          }
          return false;
        };
        for (let i = 0; i < pa.length; i += 4) {
          const delta = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
          const p = i / 4, x = p % w, y = (p - x) / w;
          if (delta > DELTA && !(near(pa, pb, i, x, y) && near(pb, pa, i, x, y))) {
            n += 1; d[i] = 214; d[i + 1] = 39; d[i + 2] = 40; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
            // below the nav bar (64 px) counted apart
            if (y >= 64) { m += 1; if (x < u0) u0 = x; if (y < v0) v0 = y; if (x > u1) u1 = x; if (y > v1) v1 = y; }
          }
          else { const g = 255 - (255 - (pa[i] + pa[i + 1] + pa[i + 2]) / 3) * 0.3; d[i] = d[i + 1] = d[i + 2] = g; }
          d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        const blob = await out.convertToBlob({ type: 'image/png' });
        const url = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
        return { a: [a.width, a.height], b: [b.width, b.height], n, share: n / (w * h), box: x1 < 0 ? null : [x0, y0, x1, y1], below: m, belowBox: u1 < 0 ? null : [u0, v0, u1, v1], png: url.split(',')[1] };
      })()`);
    }
    async function capture(site, item) {
      const url = site === 'legacy' ? `${base}${LEGACY}${item.path.slice(1)}` : `${compareWith}${item.path}`;
      const tab = await open(url, { reduceMotion: true, latency: LATENCY });
      try {
        if (item.full) { await tab.evaluate(scrollThrough()); await tab.settle(); }
        if (item.action) { await tab.evaluate(item.action); }
        if (item.ready) await tab.until(item.ready, 20000);
        await tab.settle(600, 10000);
        await wait(item.pause || 500);
        // Loaded pictures decoded in full before the capture, so a page captured beyond the screen does not catch some of
        // them mid-decode (the gallery's previews say decoding="async"; lazy ones never asked for are left alone).
        await tab.evaluate(`Promise.all([...document.images].filter(i => i.complete && i.naturalWidth).map(i => { i.decoding = 'sync'; return i.decode().catch(() => 0); })).then(() => 1)`);
        const png = await tab.shot(path.join(shots, `${item.name}-${site}.png`), item.full);
        if (site === 'legacy') account(tab, `对比 ${item.name}`);
        return png;
      } finally { await tab.close(); }
    }
    console.log(`\n与 ${compareWith} 逐页截图对比（1440×900，减弱动态，每个请求加 ${LATENCY} ms 延迟；截图写到 ${path.relative(root, shots) || shots}/）：`);
    const only = option('--cases')?.split(',');
    for (const item of CASES.filter(c => !only || only.includes(c.name))) {
      const legacy = await capture('legacy', item);
      const live = await capture('live', item);
      const d = await diff(legacy, live);
      await writeFile(path.join(shots, `${item.name}-diff.png`), Buffer.from(d.png, 'base64'));
      const same = d.a[0] === d.b[0] && d.a[1] === d.b[1];
      // The one expected difference is in the nav bar (64 px tall): the small “新版” at its right end, and the items to
      // its left moved over to make room. Anything below the nav bar fails.
      const navOnly = Boolean(d.box && !d.below);
      check(`${item.name}：${d.a.join('×')} 对 ${d.b.join('×')}，不同的像素 ${(d.share * 100).toFixed(3)}%${d.box ? `，在 x ${d.box[0]}–${d.box[2]}、y ${d.box[1]}–${d.box[3]}${navOnly ? '（只在导航栏：“新版”和给它让位的导航项）' : `；导航栏以下 ${d.below} 个，在 x ${d.belowBox[0]}–${d.belowBox[2]}、y ${d.belowBox[1]}–${d.belowBox[3]}`}` : ''}`,
        same && (d.n === 0 || navOnly));
    }
    await differ.close();
  }
} finally {
  socket.close();
  chrome.kill();
  await stopWrangler();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter(ok => !ok).length;
console.log(failed ? `\n${failed} 项没有通过。` : `\n全部 ${results.length} 项通过。`);
process.exit(failed ? 1 : 0);
