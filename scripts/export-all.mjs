// 把全部原型合页（prototype/all.html）导出为一个自包含的 HTML 文件：在 Finder 里双击，用 Safari 或 Chrome
// 以 file:// 打开就能用，不需要服务。21 节照常懒加载、离视野卸载，顶栏切帧与切数据集照常工作。
//
//   node scripts/export-all.mjs                                       # 写到 .local/export/fold-prototypes.html
//   node scripts/export-all.mjs --out ~/Downloads/fold-prototypes.html
//
// 浏览器在 file:// 下不能跨文件 import 模块，也不能 fetch 本地文件，所以代码、样式与演示数据都内联，且每份只存一份：
// - 代码：用 esbuild 把合页和 17 个原型页面的模块打成一个 ES module，作为 JSON 字符串存一次（演示数据里有
//   <!-- 与 <script，直接放进 <script> 会改变 HTML 解析）。合页和每个 iframe 都在 <body> 末尾用它插入一段模块脚本，
//   按 window.__foldPage 只执行自己那一页，其余模块不初始化；iframe 由 srcdoc 构造（页面模板 + 这段启动脚本）。
// - 地址参数：srcdoc 文档没有 location.search，history.replaceState 也改不了 about:srcdoc 的地址。打包时把
//   location.search / location.pathname / history.replaceState 换成 window.__foldLocation，它在 iframe 里
//   保存一份虚拟的页面路径与查询串（?variant= ?frame= ?data= embed=1 card=0），在合页里直接转给真实地址。
// - 样式：每份 CSS 存一次。页面的 <link rel="stylesheet"> 换成占位的 <link rel="fold-css">（按 href 找它的
//   选择器仍然命中，移除它时连同样式一起移除）加一段 <style>；页面运行中再加的样式表从合页取文本，改用 data: 地址。
// - 链接：单文件版没有单独页面。合页里的“单独打开”“打磨记录”与画廊链接不出现；iframe 里指向其他页面的链接
//   点了只提示，不跳转。站外链接照常打开。
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prototype = path.join(root, 'prototype');
const posix = path.posix;

function args(argv) {
  const out = { out: '.local/export/fold-prototypes.html' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in out) || argv[i + 1] == null) throw new Error(`未知参数 ${argv[i]}；用法：node scripts/export-all.mjs [--out <文件>]`);
    out[key] = argv[i += 1];
  }
  out.out = out.out.startsWith('~/') ? path.join(homedir(), out.out.slice(2)) : path.resolve(root, out.out);
  return out;
}

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  throw new Error('找不到 esbuild（devDependencies）；先在仓库根目录运行 npm ci。');
}

// Reads of the address inside the pages go to window.__foldLocation (see frameShim and parentShim below).
const define = {
  'location.search': '__foldLocation.search',
  'location.pathname': '__foldLocation.pathname',
  'globalThis.location': '__foldLocation',
  'history.replaceState': '__foldLocation.replaceState',
  'window.history.replaceState': '__foldLocation.replaceState',
  'history.pushState': '__foldLocation.replaceState',
};

async function files(directory, test) {
  const out = [];
  for (const entry of await readdir(path.join(prototype, directory), { withFileTypes: true })) {
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory() && entry.name !== 'vendor') out.push(...await files(relative, test));
    else if (entry.isFile() && test(relative)) out.push(relative);
  }
  return out.sort();
}

// The pages all.html embeds: the original and A/B/C/D share index.html; the forms and the five review charts have
// their own. The gallery (forms/index.html) only links to separate pages, which the single file does not have.
const pages = ['index.html', ...(await files('forms', p => p.endsWith('.html') && p !== 'forms/index.html'))];
const css = Object.fromEntries(await Promise.all((await files('', p => p.endsWith('.css'))).map(async p => [p, await readFile(path.join(prototype, p), 'utf8')])));
for (const [name, text] of Object.entries(css)) {
  if (/<\/style/i.test(text)) throw new Error(`${name} 含 </style，不能内联`);
  if (/url\(\s*['"]?(?!#|data:)/.test(text)) throw new Error(`${name} 引用了外部文件（url()），单文件版需要先内联它`);
}

/** Split a page into a template (scripts and stylesheets replaced) and the source of its module script. */
async function template(page) {
  const html = await readFile(path.join(prototype, page), 'utf8');
  const lang = html.match(/<html\b[^>]*\blang="([^"]*)"/)?.[1] || 'zh-CN';
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1];
  const body = html.match(/<body([^>]*)>([\s\S]*?)<\/body>/);
  if (head == null || !body) throw new Error(`${page}：找不到 <head> 或 <body>`);
  const modules = [];
  const rewrite = async part => {
    part = part.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => {
      const name = posix.normalize(posix.join(posix.dirname(page), href));
      if (!css[name]) throw new Error(`${page}：找不到样式表 ${href}`);
      return `<link rel="fold-css" href="${href}"><style data-fold-css="${name}"></style>`;
    });
    const scripts = [...part.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    const replaced = [];
    for (const [tag, attributes, code] of scripts) {
      if (/type="module"/.test(attributes)) {
        const src = attributes.match(/src="([^"]+)"/)?.[1];
        modules.push(src ? `import './${src}';` : code);
        replaced.push([tag, '']);
      } else {
        const { code: classic } = await esbuild.transform(code, { define, charset: 'utf8', loader: 'js' });
        replaced.push([tag, `<script>${classic}</script>`]);
      }
    }
    for (const [tag, next] of replaced) part = part.replace(tag, () => next);
    return part;
  };
  const result = { lang, head: await rewrite(head), attributes: body[1], body: await rewrite(body[2]) };
  if (modules.length !== 1) throw new Error(`${page}：应有一个模块脚本，实际 ${modules.length} 个`);
  return { ...result, module: modules[0] };
}

const templates = Object.fromEntries(await Promise.all([...pages, 'all.html'].map(async page => [page, await template(page)])));

// One ES module for all pages; each page's own module script becomes a lazily imported module.
const { datasets } = await import(pathToFileURL(path.join(prototype, 'data/select.mjs')).href);
const plugin = {
  name: 'fold-export',
  setup(build) {
    build.onResolve({ filter: /^fold-export:entry$/ }, () => ({ path: 'entry', namespace: 'fold-export' }));
    build.onLoad({ filter: /.*/, namespace: 'fold-export' }, () => ({
      resolveDir: prototype,
      contents: `const pages = {\n${Object.keys(templates).map(page => `  ${JSON.stringify(page)}: () => import(${JSON.stringify(`fold-page:${page}`)}),`).join('\n')}\n};
const page = globalThis.__foldPage;
if (!Object.hasOwn(pages, page)) throw new Error(\`单文件版里没有这一页：\${page}\`);
await pages[page]();\n`,
    }));
    build.onResolve({ filter: /^fold-page:/ }, args => ({ path: args.path.slice('fold-page:'.length), namespace: 'fold-page' }));
    build.onLoad({ filter: /.*/, namespace: 'fold-page' }, args => ({
      resolveDir: path.join(prototype, posix.dirname(args.path)), contents: templates[args.path].module,
    }));
    // scenario.mjs imports its dataset through a computed URL; the bundle needs one static import per dataset.
    build.onLoad({ filter: /[\\/]prototype[\\/]scenario\.mjs$/ }, () => ({
      resolveDir: prototype,
      contents: `import { currentDataset, datasets, keepDataset } from './data/select.mjs';
export const dataset = currentDataset();
const modules = {\n${Object.entries(datasets).map(([name, d]) => `  ${JSON.stringify(name)}: () => import(${JSON.stringify(`./data/${d.module.replace(/^\.\//, '')}`)}),`).join('\n')}\n};
const module = await modules[dataset]();
export const scenario = module.scenario;
export const notice = datasets[dataset].notice;
keepDataset();
export default scenario;\n`,
    }));
    // ?v= only keeps a browser from mixing cached versions; without it one module is loaded once.
    build.onLoad({ filter: /\.mjs$/ }, async args => ({
      contents: (await readFile(args.path, 'utf8')).replace(/(\.mjs)\?v=[^'"`]*/g, '$1'),
      loader: 'js',
    }));
  },
};
const built = await esbuild.build({
  entryPoints: ['fold-export:entry'], bundle: true, format: 'esm', write: false, charset: 'utf8', minify: true,
  legalComments: 'none', logLevel: 'silent', define, plugins: [plugin],
});
for (const warning of built.warnings) console.warn(`esbuild：${warning.text}${warning.location ? `（${warning.location.file}:${warning.location.line}）` : ''}`);
const bundle = built.outputFiles[0].text;
const leftovers = bundle.match(/\blocation\.(?:search|pathname)\b|\bhistory\.(?:replace|push)State\b|\bimport\s*\(/g);
if (leftovers) throw new Error(`打包结果里还有没换掉的读取：${[...new Set(leftovers)].join('、')}`);

/* Runs first in every iframe, before the page's own scripts. Not called here: its source is copied into srcdoc. */
function frameShim({ page, search, root }) {
  const base = new URL(page, root), rootPath = new URL(root).pathname;
  let query = search;
  window.__foldPage = page;
  window.__foldLocation = {
    get search() { return query; },
    get pathname() { return base.pathname; },
    get href() { return base.href + query; },
    replaceState(state, title, url) { if (url != null) query = new URL(String(url), base.href + query).search; },
  };
  // A placeholder <link rel="fold-css"> stands where the stylesheet link was; removing it removes its styles too.
  new MutationObserver(records => {
    for (const record of records) for (const node of record.removedNodes) {
      if (node.localName === 'link' && node.rel === 'fold-css' && record.nextSibling?.dataset?.foldCss) record.nextSibling.remove();
    }
  }).observe(document.head, { childList: true });
  // Stylesheets a page adds while running take their text from the export.
  const href = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
  Object.defineProperty(HTMLLinkElement.prototype, 'href', { ...href, set(value) {
    const url = new URL(String(value), base);
    let text = null;
    try { if (url.protocol === base.protocol && url.pathname.startsWith(rootPath)) text = window.parent.foldExport.css(url.pathname.slice(rootPath.length)); } catch {}
    href.set.call(this, text == null ? value : `data:text/css;charset=utf-8,${encodeURIComponent(text)}`);
  } });
  // Links to other pages have nowhere to go; links within the page and to other sites work as usual.
  let note = null, timer = null;
  addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link || event.defaultPrevented || link.getAttribute('href').startsWith('#')) return;
    if (/^(?:https?|mailto|blob|data):$/.test(new URL(link.href, base).protocol)) return;
    event.preventDefault();
    note ||= Object.assign(document.createElement('div'), { role: 'status' });
    note.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;max-width:80vw;padding:8px 14px;border-radius:8px;background:#1f2a24;color:#f4f4ef;font:13px/1.5 system-ui,sans-serif;box-shadow:0 8px 24px rgb(0 0 0 / .2);pointer-events:none';
    note.textContent = '单文件版没有单独页面：这些原型都在这一页里，往上或往下找对应的一节。';
    document.body.append(note);
    clearTimeout(timer); timer = setTimeout(() => note.remove(), 3200);
  });
}

/* Runs in the exported page itself, at the end of <head>. all.html reads window.foldExport. */
function parentShim({ notice, frameShim, start }) {
  const assets = JSON.parse(document.getElementById('fold-assets').textContent);
  const fill = html => html.replace(/<style data-fold-css="([^"]+)"><\/style>/g, (_, name) => `<style data-fold-css="${name}">${assets.css[name]}</style>`);
  document.querySelectorAll('style[data-fold-css]').forEach(style => { style.textContent = assets.css[style.dataset.foldCss]; });
  window.__foldPage = 'all.html';
  window.__foldLocation = {
    get search() { return location.search; },
    get pathname() { return location.pathname; },
    get href() { return location.href; },
    replaceState(...args) { try { history.replaceState(...args); } catch {} },
  };
  // This file stands in for prototype/all.html, so its folder stands in for prototype/.
  const root = new URL('.', location.href);
  window.foldExport = {
    notice, start, code: assets.code,
    css: name => assets.css[name] ?? null,
    load(iframe, src) {
      if (src === 'about:blank') { iframe.removeAttribute('srcdoc'); iframe.src = 'about:blank'; return; }
      const url = new URL(src, location.href);
      const page = url.pathname.slice(root.pathname.length);
      const t = assets.pages[page];
      if (!t || !url.pathname.startsWith(root.pathname)) throw new Error(`单文件版里没有这一页：${src}`);
      const config = JSON.stringify({ page, search: url.search, root: root.href }).replace(/</g, '\\u003c');
      iframe.srcdoc = `<!doctype html><html lang="${t.lang}"><head><script>(${frameShim})(${config})<\/script>${fill(t.head)}</head>`
        + `<body${t.attributes}>${fill(t.body)}<script>${start}<\/script></body></html>`;
    },
  };
}

function commit() {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'prototype'], { cwd: root, encoding: 'utf8' }).trim();
    return `${sha}${dirty ? '（prototype/ 有未提交改动）' : ''}`;
  } catch {
    return '未知提交';
  }
}

const options = args(process.argv.slice(2));
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const frames = Object.fromEntries(pages.map(page => [page, (({ module, ...t }) => t)(templates[page])]));
const assets = JSON.stringify({ css, pages: frames, code: bundle }).replace(/</g, '\\u003c');
const shell = templates['all.html'];
// Every document, the export itself and each iframe, ends with this: it runs the one bundle as an inline module,
// which starts the page named by __foldPage. (In the export itself `parent` is the window itself.)
const start = '{ const s = document.createElement("script"); s.type = "module"; s.textContent = parent.foldExport.code; document.body.append(s); }';
const info = JSON.stringify({ notice: `单文件版：${day} 由 ${commit()} 导出，各节没有单独页面。`, frameShim: frameShim.toString(), start }).replace(/</g, '\\u003c');
const html = `<!doctype html>
<html lang="${shell.lang}">
<head>${shell.head.replace(/\s*$/, '')}
<script type="application/json" id="fold-assets">${assets}</script>
<script>(${parentShim})(${info})</script>
</head>
<body${shell.attributes}>${shell.body}<script>${start}</script>
</body>
</html>
`;
await mkdir(path.dirname(options.out), { recursive: true });
await writeFile(options.out, html);
const mb = bytes => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
console.log(`已导出 ${options.out}：${mb(Buffer.byteLength(html))}，其中代码与演示数据 ${mb(Buffer.byteLength(bundle))}，`
  + `样式 ${mb(Buffer.byteLength(Object.values(css).join('')))}；合页加 ${pages.length} 个页面模板。`);
