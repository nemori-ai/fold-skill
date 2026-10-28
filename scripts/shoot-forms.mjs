// 用本机 Chrome（无头）给原型的每种形式截一张图，并收集页面报错。只用 Node 22 内置的 fetch 与 WebSocket，
// 通过 Chrome DevTools Protocol 驱动，不装依赖。原型需先在本地提供服务（make prototype，或任意静态服务）。
//
//   node scripts/shoot-forms.mjs                                 # 全部形式，默认数据，1440×900，写到 .local/polish-base/
//   node scripts/shoot-forms.mjs --data story --out .local/shots-story
//   node scripts/shoot-forms.mjs --only d,watch --frame 12       # 只截部分形式；--frame 覆盖各自的默认帧
//   node scripts/shoot-forms.mjs --base http://127.0.0.1:4183    # 原型服务地址，默认 http://127.0.0.1:4173
//   node scripts/shoot-forms.mjs --only d --frame 26 --scale 2     # 2 倍像素密度，供裁切后放进文档（版面仍按 1440×900）
//   node scripts/shoot-forms.mjs --check d-respond               # 额外跑一段交互检查（见 CHECKS）
//   node scripts/shoot-forms.mjs --only d --eval "document.querySelector('.d-card button').click()"   # 截图前先执行
//   node scripts/shoot-forms.mjs --gpu --only pulse --frame 20   # 用显卡渲染（默认关显卡）；WebGL 画面与余辉要用它截，体验站的 pulse 预览图也用它
//
// 每种形式输出 <out>/<form>.png，另写 <out>/report.json：URL、页面报错、控制台错误与截图路径。
// 任一形式有报错时退出码为 1。CHROME 环境变量可指定浏览器路径。
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FORMS = {
  original: 'index.html', a: 'index.html?variant=a', b: 'index.html?variant=b', c: 'index.html?variant=c', d: 'index.html?variant=d',
  watch: 'forms/watch.html', multiples: 'forms/multiples.html', gallery: 'forms/index.html', respond: 'forms/respond.html',
  timing: 'forms/sketches/timing.html', lineage: 'forms/sketches/lineage.html', yield: 'forms/sketches/yield.html',
  provenance: 'forms/sketches/provenance.html', notation: 'forms/sketches/notation.html',
  // 第四轮：关系的画法。
  morph: 'forms/sketches/morph.html',
  peak: 'forms/sketches/peak.html',
  age: 'forms/sketches/age.html',  // 不带 --frame 时顶层打开会先讲一遍（截图落在讲到一半），带 --frame 时静止在那一帧
  chain: 'forms/sketches/chain.html',
  // 拔河不带 --frame 时页面在顶层会自己讲一遍，截到的是讲到约 2.5 秒的样子；静止的一帧要带 --frame。
  tug: 'forms/sketches/tug.html',
  khipu: 'forms/sketches/khipu.html',   // 默认样张是手写情境（composite 两周没有子层），截预览时带 --data story
  // 第一轮撤下后恢复的八个形式：只做了能在两个数据集下运行的最小适配，未打磨。
  radio: 'forms/radio.html', strips: 'forms/strips.html', frontpage: 'forms/frontpage.html', receipt: 'forms/receipt.html',
  orb: 'forms/orb.html', departures: 'forms/departures.html', blame: 'forms/blame.html', chat: 'forms/chat.html',
  // 第三轮：概念动画。带 --frame 时停在那一帧（整理脉冲先演一遍那一轮再停住），不带时播放各自的循环。
  pulse: 'forms/motion/pulse.html',
  dial: 'forms/motion/dial.html',
  // 所有原型合在一页；截图只看首屏，iframe 里的报错也会冒到这里。
  all: 'all.html',
};

// Interaction checks run in the page after load; each returns a list of failures (empty = pass).
const CHECKS = {
  // D 的回应控件经 respond.mjs：选项、稍后、撤回、金额键盘与回复都要走通。
  'd-respond': `(async () => {
    const fail = [], wait = ms => new Promise(r => setTimeout(r, ms)), $ = s => document.querySelector(s);
    const card = [...document.querySelectorAll('.d-card')].find(c => c.querySelector('[data-rs-act]'));
    if (!card) return ['没有带选项的卡片'];
    const id = card.dataset.id, button = card.querySelector('[data-rs-act]');
    button.click(); await wait(200);
    const receipt = document.querySelector('.d-card[data-id="' + id + '"] .d-receipt');
    if (!receipt) fail.push('点选项后没有回执'); else if (!/等 Agent 下一轮整理/.test(receipt.textContent)) fail.push('回执文字不对：' + receipt.textContent);
    document.querySelector('.d-card[data-id="' + id + '"] [data-rs-undo]')?.click(); await wait(200);
    if (!document.querySelector('.d-card[data-id="' + id + '"] [data-rs-act]')) fail.push('撤回后没有恢复按钮');
    document.querySelector('.d-card[data-id="' + id + '"] [data-rs-open="defer"]')?.click(); await wait(200);
    const options = document.querySelectorAll('.d-sheet [data-rs-defer]');
    if (options.length !== 3) fail.push('稍后提醒应有 3 个选项，实际 ' + options.length);
    options[0]?.click(); await wait(700);
    if (document.querySelector('.d-card[data-id="' + id + '"]')) fail.push('稍后提醒后卡片仍在首页');
    if ($('.d-snoozed')?.hidden) fail.push('没有显示稍后提醒的计数');
    document.querySelector('[data-d="reset"]')?.click(); await wait(200);
    if (!document.querySelector('.d-card[data-id="' + id + '"]')) fail.push('清除本页反馈后卡片没有回来');
    return fail;
  })()`,
  // 合页：逐节滚到每个 iframe 等它报告所在帧，再在顶栏选一帧，逐节确认每一页都切到了那一帧。
  // 离视野远的页会被卸载，所以每一节在滚到它时当场记下结果。
  'all-sync': `(async () => {
    const fail = [], wait = ms => new Promise(r => setTimeout(r, ms));
    const { sections, choose } = window.foldAll;
    const visit = async target => {
      const seen = {};
      for (const s of sections) {
        s.el.scrollIntoView();
        for (let t = 0; t < 60 && !(s.ready && (target == null || s.at === target)); t += 1) await wait(200);
        seen[s.id] = s.ready ? s.at : null;
      }
      return seen;
    };
    const first = await visit(null);
    for (const s of sections) if (first[s.id] == null) fail.push(s.id + ' 没有报告所在帧');
    const target = Math.floor((first.original ?? 6) / 2) || 3;
    window.scrollTo(0, 0); await wait(400);
    choose(target);
    const second = await visit(target);
    for (const s of sections) if (second[s.id] !== target) fail.push(s.id + ' 停在 ' + second[s.id] + '，应为 ' + target);
    // 在某一页里自己往后走一帧，合页不应把它拉回顶栏选的帧。
    const watch = sections.find(s => s.id === 'watch');
    watch.el.scrollIntoView(); await wait(1500);
    watch.iframe.contentDocument.querySelector('[data-step="1"]').click(); await wait(1500);
    if (watch.at !== target + 1) fail.push('在腕上一瞥里往后一帧后停在 ' + watch.at + '，应为 ' + (target + 1));
    window.scrollTo(0, 0); await wait(400);
    return fail;
  })()`,
};

function args(argv) {
  const out = { data: null, base: 'http://127.0.0.1:4173', out: '.local/polish-base', only: null, frame: null, width: 1440, height: 900, scale: 1, check: [], eval: null, gpu: false };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, value] = [argv[i].replace(/^--/, ''), argv[i + 1]];
    if (key === 'gpu') out.gpu = true;
    else if (key === 'check') { out.check.push(value); i += 1; } else if (key in out) { out[key] = value; i += 1; } else throw new Error(`未知参数 ${argv[i]}`);
  }
  out.only = out.only ? out.only.split(',') : Object.keys(FORMS);
  return out;
}

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return 'google-chrome';
}

async function launch(width, height, gpu = false) {
  const profile = await mkdtemp(path.join(tmpdir(), 'fold-shoot-'));
  // Without --gpu the pages render in software (WebGL pages fall back to Canvas 2D); with it, through the GPU.
  const graphics = gpu ? ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] : ['--disable-gpu'];
  const chrome = spawn(chromePath(), ['--headless=new', ...graphics, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--window-size=${width},${height}`, '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let text = '';
    chrome.stderr.on('data', chunk => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]); });
    chrome.on('exit', code => reject(new Error(`Chrome 退出：${code}\n${text}`)));
    setTimeout(() => reject(new Error('Chrome 没有启动调试端口')), 15000);
  });
  return { chrome, profile, endpoint };
}

function connect(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map(), listeners = new Set();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    } else for (const fn of listeners) fn(message);
  };
  const ready = new Promise(resolve => { socket.onopen = resolve; });
  return {
    ready,
    send: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const message = { id: ++id, method, params, ...(sessionId ? { sessionId } : {}) };
      pending.set(message.id, { resolve, reject });
      socket.send(JSON.stringify(message));
    }),
    on: fn => listeners.add(fn),
    close: () => socket.close(),
  };
}

async function shoot(cdp, url, file, { width, height, scale, checks, script }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  const errors = [];
  const listener = message => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value ?? a.description).join(' '));
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error' && !/favicon\.ico/.test(message.params.entry.url || '')) errors.push(`${message.params.entry.text} ${message.params.entry.url || ''}`.trim());
  };
  cdp.on(listener);
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  await send('Page.navigate', { url });
  // Let modules, fonts and the first transitions settle.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const { result } = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (result.value === 'complete') break;
    await new Promise(r => setTimeout(r, 200));
  }
  await new Promise(r => setTimeout(r, 2500));
  const failures = {};
  for (const name of checks) {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression: CHECKS[name], awaitPromise: true, returnByValue: true });
    failures[name] = exceptionDetails ? [exceptionDetails.exception?.description || exceptionDetails.text] : result.value;
  }
  if (script) {
    const { exceptionDetails } = await send('Runtime.evaluate', { expression: script, awaitPromise: true });
    if (exceptionDetails) errors.push(`--eval：${exceptionDetails.exception?.description || exceptionDetails.text}`);
    await new Promise(r => setTimeout(r, 800));
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(file, Buffer.from(data, 'base64'));
  await cdp.send('Target.closeTarget', { targetId });
  return { errors, checks: failures };
}

async function main() {
  const options = args(process.argv.slice(2));
  const out = path.resolve(root, options.out);
  await mkdir(out, { recursive: true });
  const { chrome, profile, endpoint } = await launch(options.width, options.height, options.gpu);
  const cdp = connect(endpoint);
  await cdp.ready;
  const report = [];
  try {
    for (const form of options.only) {
      if (!FORMS[form]) throw new Error(`未知形式 ${form}；可选：${Object.keys(FORMS).join(', ')}`);
      const url = new URL(FORMS[form], `${options.base.replace(/\/$/, '')}/`);
      if (options.data) url.searchParams.set('data', options.data);
      if (options.frame != null) url.searchParams.set('frame', options.frame);
      const file = path.join(out, `${form}.png`);
      const checks = options.check.filter(name => name.startsWith(`${form}-`));
      const result = await shoot(cdp, url.href, file, { width: Number(options.width), height: Number(options.height), scale: Number(options.scale), checks, script: options.eval });
      report.push({ form, url: url.href, screenshot: path.relative(root, file), ...result });
      const failed = Object.values(result.checks).flat();
      console.log(`${result.errors.length || failed.length ? '✗' : '✓'} ${form.padEnd(10)} ${url.pathname}${url.search}${result.errors.length ? `\n    报错：${result.errors.join('\n    报错：')}` : ''}${failed.length ? `\n    检查：${failed.join('\n    检查：')}` : ''}`);
    }
  } finally {
    cdp.close();
    chrome.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (report.some(entry => entry.errors.length || Object.values(entry.checks).flat().length)) process.exitCode = 1;
}

await main();
