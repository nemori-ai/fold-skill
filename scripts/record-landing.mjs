// 入口页的录像：逐个顶层打开原型（不带 ?frame=、没有 referrer，让它自己“讲一遍”），用 Chrome 的 screencast 录下来，
// 重采样到 15 帧/秒，交给 ffmpeg 编成 H.264 MP4（muted、faststart），存进 site/media/<id>.mp4；六张卡另存一张封面
// site/media/<id>.webp。录哪些、按什么顺序，跟入口页一样由 site/.vitepress/theme/prototypes.mjs 与 landing.mjs 决定：
// 六张卡（TOP）按卡的尺寸录（手机 390 × 844，或 iPad 横 1180 × 820），其余的按桌面 1440 × 900 录成 480 × 300 的小块。
// 新加的原型不用改这里就能录（默认桌面尺寸、12 秒）；不会自己讲一遍的，在 SPECS 里写怎样让它动起来。
//
//   node scripts/record-landing.mjs                      # 全部（约 8 分钟）
//   node scripts/record-landing.mjs --only duo,glasses   # 只录这几个
//
// 默认自己起一个本地静态服务（scripts/serve-static.mjs），原型在它的 /prototype/ 下；也可用 --base 指向已有的站点。
// 需要本机 Chrome（CHROME 可指定）、ffmpeg 与 cwebp；
// 它们和截图脚本一样是开发机上的工具，不是 npm 依赖。预算（site/landing/spec.md F）：小块 ≤ 120 KB，卡片录像 ≤ 300 KB，封面 ≤ 15 KB。
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prototypes } from '../site/.vitepress/theme/prototypes.mjs';
import { TOP, directHref, galleryOf } from '../site/.vitepress/theme/landing.mjs';
import { serve } from './serve-static.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const server = option('--base') ? null : await serve(root);
const base = (option('--base') || server.url).replace(/\/$/, '');
const only = option('--only')?.split(',').map(s => s.trim()).filter(Boolean);
const out = path.join(root, option('--out') || 'site/media');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const SIZES = {
  phone: { width: 390, height: 844, scale: 2, mobile: true, ua: PHONE_UA, encode: 'scale=480:-2' },
  pad: { width: 1180, height: 820, scale: 1, mobile: true, ua: PAD_UA, encode: 'scale=960:-2' },
  desk: { width: 1440, height: 900, scale: 1, mobile: false, ua: null, encode: 'scale=480:300' },
};

// How to make a page move when it does not tell its story by itself, and where to crop. `steps`: open at that
// frame and press → once per step; `run`: a script to evaluate at a time (ms after load); `crop` in CSS px.
const SPECS = {
  // D: the round changes to f26 with its own motion, then a tap answers the lead card and it folds into a receipt.
  d: { url: '/prototype/?variant=d&embed=1&frame=25', seconds: 9, run: [[1000, 'window.foldHome.go(26)'], [4800, `document.querySelectorAll('.d-card:not(.is-answered) [data-rs-act]')[1]?.click()`]] },
  watch: { seconds: 11, crop: { x: 0, y: 64, width: 390, height: 600 } },
  trays: { seconds: 10 },
  // E: on f26 (158 inputs → 3 cards, as the landing says), fold the device shut and open it again — the unfolding
  // is the form. Cropped to the device.
  duo: { url: '/prototype/?variant=duo&frame=26', seconds: 10, crop: { x: 340, y: 20, width: 830, height: 592 }, encode: 'scale=720:-2',
    run: [[500, `document.querySelector('[data-posture="closed"]').click()`], [2300, `document.querySelector('[data-posture="book"]').click()`]] },
  multiples: { seconds: 12 },
  // B: the round turns from f25 to f26 with its own motion; the nearest deadline is then 34 hours away.
  b: { url: '/prototype/?variant=b&frame=25', seconds: 8, run: [[1200, 'key:ArrowRight']] },
  // Busy pictures: a little more compression keeps them inside the tile budget.
  dial: { seconds: 10, crf: 35 }, age: { crf: 35 },
  lineage: { steps: 20 }, provenance: { steps: 20 }, notation: { steps: 20 }, respond: { seconds: 10 },
  radio: { steps: 20 }, strips: { steps: 20 }, frontpage: { steps: 20 }, receipt: { steps: 20 }, orb: { steps: 20 },
  departures: { steps: 20 }, blame: { steps: 20 }, chat: { steps: 20 },
};

async function chrome() {
  const profile = await mkdtemp(path.join(tmpdir(), 'fold-record-'));
  const child = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let text = '';
    child.stderr.on('data', chunk => { text += chunk; const m = text.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
    child.on('exit', code => reject(new Error(`Chrome exited (${code})`)));
    setTimeout(() => reject(new Error('Chrome did not start')), 15000);
  });
  const socket = new WebSocket(endpoint);
  await new Promise(resolve => { socket.onopen = resolve; });
  let id = 0;
  const pending = new Map(), listeners = new Set();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); }
    else for (const fn of listeners) fn(message);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const m = { id: ++id, method, params, ...(sessionId ? { sessionId } : {}) }; pending.set(m.id, { resolve, reject }); socket.send(JSON.stringify(m)); });
  return { send, listeners, async close() { socket.close(); child.kill(); await rm(profile, { recursive: true, force: true }).catch(() => {}); } };
}

async function record(browser, spec) {
  const { id, size, url, seconds = 12, steps = 0, run = [], crop } = spec;
  const s = SIZES[size];
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => browser.send(m, p, sessionId);
  const errors = [];
  const frames = [];
  const listen = m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.screencastFrame') {
      frames.push({ t: m.params.metadata.timestamp, data: m.params.data });
      send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
    }
  };
  browser.listeners.add(listen);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: s.width, height: s.height, deviceScaleFactor: s.scale, mobile: s.mobile });
  if (s.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (s.ua) await send('Emulation.setUserAgentOverride', { userAgent: s.ua });
  const address = new URL(url, base);
  if (steps) address.searchParams.set('frame', String(Math.max(0, 26 - Math.min(steps, 6))));
  // Screencast frames come only while the tab is in front and painting: start before loading, keep from load on.
  await send('Page.bringToFront');
  await send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1, maxWidth: s.width * s.scale, maxHeight: s.height * s.scale });
  await send('Page.navigate', { url: address.href });
  for (let i = 0; i < 100; i += 1) {
    const { result } = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (result.value === 'complete') break;
    await wait(100);
  }
  await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => 1)', awaitPromise: true });
  await wait(250);
  frames.splice(0, Math.max(0, frames.length - 1));
  const started = Date.now();
  const actions = [...run];
  if (steps) for (let k = 0; k < Math.min(steps, 6); k += 1) actions.push([900 + k * 1700, 'key:ArrowRight']);
  for (const [at, what] of actions.sort((a, b) => a[0] - b[0])) {
    const delay = at - (Date.now() - started);
    if (delay > 0) await wait(delay);
    if (what.startsWith('key:')) {
      const key = JSON.stringify(what.slice(4));
      await send('Runtime.evaluate', { expression: `(document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: ${key}, code: ${key}, bubbles: true }))` });
    } else {
      await send('Runtime.evaluate', { expression: what });
    }
  }
  const rest = seconds * 1000 - (Date.now() - started);
  if (rest > 0) await wait(rest);
  await send('Page.stopScreencast');
  // Frames arrive only when something paints; a page that comes to rest is held on its last frame to the end.
  const span = { from: started / 1000, to: Date.now() / 1000 };
  browser.listeners.delete(listen);
  await browser.send('Target.closeTarget', { targetId });
  if (!frames.length) throw new Error(`${id}: no frames`);
  return { frames, span, errors, viewport: s, encode: spec.encode || s.encode, crop, crf: spec.crf };
}

async function encode(id, { frames, span, viewport, encode: scaleFilter, crop, crf }, poster) {
  const work = await mkdtemp(path.join(tmpdir(), `fold-${id}-`));
  // Constant 15 fps: for each output tick, the latest frame at or before it.
  const fps = 15, start = span.from, n = Math.max(2, Math.floor((span.to - start) * fps));
  let j = 0;
  for (let i = 0; i < n; i += 1) {
    const t = start + i / fps;
    while (j + 1 < frames.length && frames[j + 1].t <= t) j += 1;
    await writeFile(path.join(work, `${String(i).padStart(4, '0')}.jpg`), Buffer.from(frames[j].data, 'base64'));
  }
  // The crop is in CSS px; frames arrive at whatever resolution the screencast chose, so scale it by iw / ih.
  const { width: W, height: H } = viewport;
  const filters = [crop && `crop=iw*${crop.width}/${W}:ih*${crop.height}/${H}:iw*${crop.x}/${W}:ih*${crop.y}/${H}`, `${scaleFilter}:flags=lanczos`].filter(Boolean).join(',');
  const file = path.join(out, `${id}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(work, '%04d.jpg'), '-vf', filters,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(crf || (poster ? 29 : 31)), '-preset', 'slow', '-tune', 'animation', '-movflags', '+faststart', '-an', file]);
  const sizes = { mp4: (await stat(file)).size };
  if (poster) {
    // The cover is the last frame: the end state the story arrives at.
    // The cover is only seen until the clip starts: two thirds of its width is enough.
    const png = path.join(work, 'poster.png');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(work, `${String(n - 1).padStart(4, '0')}.jpg`), '-vf', `${filters},scale=iw*2/3:-2:flags=lanczos`, png]);
    execFileSync('cwebp', ['-quiet', '-q', '50', '-m', '6', '-sharp_yuv', png, '-o', path.join(out, `${id}.webp`)]);
    sizes.webp = (await stat(path.join(out, `${id}.webp`))).size;
  }
  await rm(work, { recursive: true, force: true });
  return { seconds: Math.round((span.to - start) * 10) / 10, sizes };
}

const top = new Map(TOP.map(t => [t.id, t]));
const list = [...TOP.map(t => prototypes.find(p => p.id === t.id)).filter(Boolean), ...galleryOf(prototypes)]
  .filter(p => !only || only.includes(p.id));
if (only) for (const id of only) if (!list.some(p => p.id === id)) throw new Error(`Unknown prototype: ${id}`);
await mkdir(out, { recursive: true });
const browser = await chrome();
const report = [];
try {
  for (const p of list) {
    const showcase = top.get(p.id);
    const spec = { id: p.id, size: showcase ? showcase.record : 'desk', url: directHref(p), ...SPECS[p.id] };
    const taken = await record(browser, spec);
    const result = await encode(p.id, taken, Boolean(showcase));
    const budget = showcase ? 300 * 1024 : 120 * 1024;
    const over = result.sizes.mp4 > budget ? ` 超出预算 ${Math.round(budget / 1024)} KB` : '';
    report.push(`${p.id.padEnd(11)} ${spec.size.padEnd(5)} ${String(result.seconds).padStart(5)} s  mp4 ${String(Math.round(result.sizes.mp4 / 1024)).padStart(4)} KB${result.sizes.webp ? `  封面 ${Math.round(result.sizes.webp / 1024)} KB` : ''}${over}${taken.errors.length ? `  页面报错 ${taken.errors.length}` : ''}`);
    console.log(report.at(-1));
  }
} finally {
  await browser.close();
  await server?.close();
}
