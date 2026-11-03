// 旧站：把 2026-11-03 换版前的体验站构建进 dist/legacy/，由 npm run site:build 在新站构建之后调用。
//
//   node scripts/legacy-site.mjs            # dist/ 已由 vitepress build 生成；有缓存时只复制
//   node scripts/legacy-site.mjs --rebuild  # 不用缓存，重新解出、构建
//
// 1. git archive 把 LEGACY_COMMIT 解到 .local/legacy-site/src/（不建 worktree），软链根目录的 node_modules；
// 2. 只改解出来的那份源码，规则见下面的 rebase()、PATCHES，仓库里的现行代码不动；
// 3. 跑旧的 scripts/prepare-site.mjs，再 vitepress build --base /legacy/，输出到缓存目录；
// 4. 扫一遍产物：站内的根路径都要落在 /legacy/ 下，否则失败；
// 5. 复制到 dist/legacy/。缓存目录按（提交、本脚本、package-lock.json）的哈希命名，三者不变时再次构建直接复制。
//
// 只用 Node 22 内置能力与 git、tar。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 旧站就是这次提交（#46，E 折叠屏答后布局）：主域 fold.vibecoding.icu 换成新入口页之前，最后一次部署（2026-10-30，
// 版本 6f9aa042）就是它；用它跑 npm run site:build 的产物与换版前的线上一致，只有站内搜索索引的文件哈希不同。
// 它与 main 的 package-lock.json 相同，所以直接共用根目录的 node_modules。
const LEGACY_COMMIT = 'fa99395dafc0b1358fd8cad0845eee1ca2ab58df';
const BASE = '/legacy/';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, '.local/legacy-site');
const src = path.join(work, 'src');
const dist = path.join(root, 'dist');
const target = path.join(dist, BASE);
const rebuild = process.argv.includes('--rebuild');
const started = Date.now();
const seconds = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
const slash = value => value.split(path.sep).join('/');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...options });
  if (result.status !== 0) {
    process.stderr.write(`${result.stdout || ''}${result.stderr || ''}`);
    throw new Error(`${command} ${args.join(' ')} 失败（退出码 ${result.status ?? result.signal}）`);
  }
  return result.stdout;
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

// ---------- 规则一：写死在主题与原型代码里的站内根路径 ----------
// VitePress 的 base 只改写它自己经手的地址（配置里的导航与侧栏、Markdown 链接与图片、打包的资源），不改主题组件与原型页面
// 里写死的字符串，例如 '/prototype/forms/${id}.html'、'/prototype/all.html'、'/previews/${id}.webp'、'/docs/product'、
// '/prototype-notes/forms/${name}'，以及 dial.mjs 判断“在站上”的 location.pathname.startsWith('/prototype/')。
// 规则：主题源码（site/.vitepress/theme/）与原型源码（prototype/，不含 vendor/ 第三方库和 data/ 演示数据）里，引号紧跟
// 一个旧站顶层路径的字符串，前面补上 /legacy。顶层路径就是旧站发布出来的顶层目录与页面（旧 prepare-site 的输出加上
// VitePress 的 assets/）；漏了哪一个，构建后的扫描（scan()，顶层名从产物里现取）会报出来。
const SITE_ROOTS = ['prototype-notes', 'prototype', 'previews', 'docs', 'overview', 'agents', 'skill', 'corpus', 'conformance', 'source', 'assets'];
const rootString = new RegExp(String.raw`(['"\x60])/(?=(?:${SITE_ROOTS.join('|')})(?:[/?#'"\x60$]|$))`, 'g');

async function rebase() {
  const counts = {};
  const files = [
    ...(await walk(path.join(src, 'site/.vitepress/theme'))).filter(file => /\.(?:mjs|js|vue)$/.test(file)),
    ...(await walk(path.join(src, 'prototype'))).filter(file => /\.(?:html|mjs|js|css)$/.test(file)
      && !/^prototype\/(?:vendor|data)\//.test(slash(path.relative(src, file)))),
  ];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    let count = 0;
    const next = text.replace(rootString, (_, quote) => { count += 1; return `${quote}${BASE}`; });
    if (count) { counts[slash(path.relative(src, file))] = count; await writeFile(file, next); }
  }
  return counts;
}

// ---------- 规则二至四：配置与页面上的几处补丁 ----------
// 每处按原文替换，原文必须恰好出现一次，否则停下（不静默跳过）。
const PATCHES = [
  {
    // 规则二：VitePress 给 Markdown 链接补 base 时，跳过已经带 target 的链接；旧配置先给 /prototype/ 与 /docs/brief/ 的链接
    // 加上 target="_self"（它们是 VitePress 路由之外的静态页面），所以这一类链接在同一处补上 base。
    file: 'site/.vitepress/config.mts',
    find: "tokens[index].attrSet('target', '_self');",
    replace: `tokens[index].attrSet('target', '_self');
          tokens[index].attrSet('href', ${JSON.stringify(BASE.slice(0, -1))} + tokens[index].attrGet('href'));`,
  },
  {
    // 规则三：普通页面（VitePress 的文档页、首页、404）不让搜索引擎收录。原型页不加东西。
    file: 'site/.vitepress/config.mts',
    find: "head: [['link', { rel: 'icon', type: 'image/svg+xml', href: favicon }]],",
    replace: "head: [['link', { rel: 'icon', type: 'image/svg+xml', href: favicon }], ['meta', { name: 'robots', content: 'noindex' }]],",
  },
  {
    // 规则四：普通页面导航栏的右端（右上角）加一个小号淡色的“新版”链接，指向现在的站点 /。带 target，VitePress 的
    // 路由就不会把它当成旧站里的一页去载入。
    file: 'site/.vitepress/theme/index.mjs',
    find: "{ 'layout-bottom': () => h(PrototypeLayer) }",
    replace: "{ 'layout-bottom': () => h(PrototypeLayer), 'nav-bar-content-after': () => h('a', { class: 'fold-legacy-new', href: '/', target: '_self', title: '这是 2026-11-03 换版前的旧站，去看新版' }, '新版') }",
  },
  {
    file: 'site/.vitepress/theme/style.css',
    append: `
/* 旧站（/legacy/）：导航栏右端的“新版”链接，由 scripts/legacy-site.mjs 在构建旧站时加上。 */
.fold-legacy-new {
  display: inline-flex;
  align-items: center;
  height: var(--vp-nav-height);
  margin-left: 14px;
  color: var(--vp-c-text-3);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  transition: color 0.2s;
}

.fold-legacy-new:hover {
  color: var(--vp-c-text-1);
}

.fold-legacy-new:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

@media (max-width: 767px) {
  .fold-legacy-new {
    margin: 0 4px 0 8px;
  }
}
`,
  },
  {
    // 小册子（docs/brief/index.html）是一页独立的静态 HTML，与文档页一样不让搜索引擎收录；页面本身不改。
    file: 'docs/brief/index.html',
    find: '<meta charset="utf-8">\n',
    replace: '<meta charset="utf-8">\n<meta name="robots" content="noindex">\n',
  },
];

async function patch() {
  for (const { file, find, replace, append } of PATCHES) {
    const full = path.join(src, file);
    const text = await readFile(full, 'utf8');
    if (append) { await writeFile(full, `${text.trimEnd()}\n${append}`); continue; }
    const times = text.split(find).length - 1;
    if (times !== 1) throw new Error(`${file} 里应恰好有一处「${find}」，实际 ${times} 处。`);
    await writeFile(full, text.replace(find, () => replace));
  }
}

// ---------- 构建后的扫描 ----------
// 产物里所有 HTML、JS、CSS（不含原型的 vendor/ 与 data/）：引号或 url( 后面紧跟一个本站顶层路径、却不在 /legacy/ 下的，
// 都算漏网。顶层名从产物的顶层现取，不依赖上面的 SITE_ROOTS。每页内嵌的站点配置（__VP_SITE_DATA__）不算：导航与侧栏的
// 地址在那里按配置原样保存，渲染时才由 VitePress 补上 base。
async function scan(out) {
  const roots = (await readdir(out)).filter(name => name !== 'index.html').map(name => name.replace(/\.html$/, ''));
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leak = new RegExp(String.raw`(?:['"\x60]|\\"|url\()/(?:${roots.map(escape).join('|')})(?=[/?#'"\x60)\\]|$)`, 'g');
  const found = [];
  for (const file of await walk(out)) {
    const relative = slash(path.relative(out, file));
    if (!/\.(?:html|m?js|css)$/.test(relative) || /^prototype\/(?:vendor|data)\//.test(relative)) continue;
    const text = (await readFile(file, 'utf8')).replace(/window\.__VP_SITE_DATA__=[\s\S]*?<\/script>/, '');
    for (const match of text.matchAll(leak)) found.push(`${relative}: …${text.slice(Math.max(0, match.index - 40), match.index + 60).replace(/\s+/g, ' ')}…`);
  }
  return found;
}

// ---------- 主流程 ----------
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/ 里还没有新站：先运行 vitepress build site（npm run site:build 会按顺序调用本脚本）。');
  process.exit(1);
}
if (existsSync(path.join(dist, `${BASE.slice(1, -1)}.html`))) throw new Error(`新站自己有一页 ${BASE.slice(0, -1)}，与旧站的路径冲突。`);
const lock = await readFile(path.join(root, 'package-lock.json'));
const key = createHash('sha256').update(LEGACY_COMMIT).update(await readFile(fileURLToPath(import.meta.url))).update(lock).digest('hex').slice(0, 12);
const cache = path.join(work, `build-${key}`);
let built = false;

if (rebuild || !existsSync(path.join(cache, 'index.html'))) {
  if (!existsSync(path.join(root, 'node_modules/vitepress'))) throw new Error('根目录还没有 node_modules：先运行 npm ci。');
  const check = spawnSync('git', ['-C', root, 'cat-file', '-e', `${LEGACY_COMMIT}^{commit}`]);
  if (check.status !== 0) throw new Error(`仓库里没有提交 ${LEGACY_COMMIT}（浅克隆时先 git fetch --unshallow）。`);
  const legacyLock = run('git', ['-C', root, 'show', `${LEGACY_COMMIT}:package-lock.json`]);
  if (legacyLock !== lock.toString('utf8')) console.warn('注意：package-lock.json 与旧站提交时不同，旧站改用现在的依赖构建，产物可能与换版前的线上不一致。');

  console.log(`旧站：解出 ${LEGACY_COMMIT.slice(0, 7)}，用 ${BASE} 构建…`);
  await rm(work, { recursive: true, force: true });
  await mkdir(src, { recursive: true });
  const tar = path.join(work, 'legacy.tar');
  run('git', ['-C', root, 'archive', '--format=tar', '-o', tar, LEGACY_COMMIT]);
  run('tar', ['-xf', tar, '-C', src]);
  await rm(tar);
  await symlink(path.join(root, 'node_modules'), path.join(src, 'node_modules'), 'dir');

  const counts = await rebase();
  await patch();
  run(process.execPath, [path.join(src, 'scripts/prepare-site.mjs')], { cwd: src });
  const out = path.join(work, 'build-tmp');
  run(process.execPath, [path.join(src, 'node_modules/vitepress/bin/vitepress.js'), 'build', 'site', '--base', BASE, '--outDir', out], { cwd: src });

  const leaks = await scan(out);
  if (leaks.length) {
    console.error(`旧站产物里有 ${leaks.length} 处站内根路径不在 ${BASE} 下：\n${leaks.slice(0, 20).join('\n')}`);
    process.exit(1);
  }
  await rename(out, cache);
  await rm(src, { recursive: true, force: true });
  const touched = Object.entries(counts).map(([file, n]) => `${file} ${n}`).join('，');
  console.log(`旧站：根路径补上 ${BASE.slice(0, -1)} 的字符串 ${Object.values(counts).reduce((a, b) => a + b, 0)} 处（${touched}）；产物扫描通过。`);
  built = true;
}

await rm(target, { recursive: true, force: true });
// APFS 等支持时复制成克隆，不占额外空间；不支持时退回普通复制。
await cp(cache, target, { recursive: true, mode: constants.COPYFILE_FICLONE });
const files = await walk(target);
let bytes = 0;
for (const file of files) bytes += (await stat(file)).size;
console.log(`旧站：${built ? '构建并' : '从缓存'}复制到 dist${BASE}，${files.length} 个文件，${(bytes / 1048576).toFixed(1)} MB，用时 ${seconds()}（缓存 ${slash(path.relative(root, cache))}）。`);
