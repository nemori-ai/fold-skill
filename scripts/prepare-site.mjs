import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = path.join(root, 'site/.generated');
const publicDir = path.join(generated, 'public');
const slash = value => value.split(path.sep).join('/');

// Publish selected source documents and browser files, never an entire checkout.
const sourcePages = new Map([
  ['Makefile', { page: 'source/makefile.md', language: 'makefile' }],
  ['scripts/check.py', { page: 'source/check.md', language: 'python' }],
  ['.editorconfig', { page: 'source/editorconfig.md', language: 'ini' }],
  ['.gitattributes', { page: 'source/gitattributes.md', language: 'text' }],
  ['.gitignore', { page: 'source/gitignore.md', language: 'text' }],
]);
const prototypeEntries = new Set(['index.html', 'app.mjs', 'engine.mjs', 'scenario.mjs', 'motion.mjs', 'explore.mjs', 'styles.css', 'explore.css']);
const mediaExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif', '.woff', '.woff2']);
const pages = new Map([['README.md', 'overview.md'], ['AGENTS.md', 'agents.md'], ['site/index.md', 'index.md']]);
const assets = new Map();
for (const variant of ['a', 'b', 'c']) assets.set(`site/previews/${variant}.jpg`, `previews/${variant}.jpg`);

async function walk(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.name.startsWith('.') || ['node_modules', '__pycache__', 'private', 'local'].includes(entry.name)) continue;
    const relative = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Refusing to publish a symbolic link: ${relative}`);
    if (entry.isDirectory()) files.push(...await walk(relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

for (const file of await walk('docs')) {
  if (file.endsWith('.md')) pages.set(file, file);
  else if (file.startsWith('docs/assets/')) assets.set(file, file);
}

for (const file of await walk('prototype')) {
  const relative = file.slice('prototype/'.length);
  const extension = path.extname(relative);
  if (extension === '.md') {
    pages.set(file, `prototype-notes/${relative}`);
  } else if (prototypeEntries.has(relative)
    || relative.startsWith('variants/') && ['.mjs', '.js', '.css'].includes(extension)
    || relative.startsWith('vendor/') && (['.mjs', '.js', '.css'].includes(extension) || /\/(?:LICENSE|NOTICE|COPYING)(?:\.[^/]+)?$/i.test(relative))
    || relative.startsWith('assets/') && mediaExtensions.has(extension.toLowerCase())) {
    assets.set(file, file);
  }
}

const cases = (await walk('conformance/cases')).filter(file => /\.ya?ml$/.test(file));
for (const file of cases) assets.set(file, file);

function pageURL(output) {
  return `/${output.replace(/(?:^|\/)index\.md$/, match => match.startsWith('/') ? '/' : '').replace(/\.md$/, '')}`;
}

function publishedURL(input, source) {
  // Local demonstration links become live examples; prose about local commands stays intact.
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost):4173(?:\/|[?#]|$)/.test(input)) {
    const local = new URL(input);
    return `/prototype${local.pathname}${local.search}${local.hash}`;
  }
  if (!input || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(input)) return input;
  const match = input.match(/^([^?#]*)([?#].*)?$/);
  const target = slash(path.normalize(path.join(path.dirname(source), decodeURIComponent(match[1]))));
  const suffix = match[2] || '';
  if (target === '..' || target.startsWith('../')) throw new Error(`Link leaves repository in ${source}: ${input}`);
  if (pages.has(target)) return pageURL(pages.get(target)) + suffix;
  if (sourcePages.has(target)) return pageURL(sourcePages.get(target).page) + suffix;
  if (target === 'prototype/index.html') return `/prototype/${suffix}`;
  if (assets.has(target)) return `/${assets.get(target)}${suffix}`;
  if (target === 'conformance/cases') return `/conformance/cases/${suffix}`;
  if (target === 'prototype') return `/prototype/${suffix}`;
  for (const filename of ['README.md', 'index.md']) {
    const candidate = `${target.replace(/\/$/, '')}/${filename}`;
    if (pages.has(candidate)) return pageURL(pages.get(candidate)) + suffix;
  }
  throw new Error(`Unpublished local link in ${source}: ${input}`);
}

function rewriteInline(text, source) {
  // Preserve code spans, including examples that happen to contain Markdown links.
  return text.split(/(`+[^`]*`+)/g).map(part => {
    if (part.startsWith('`')) return part;
    return part
      .replace(/(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^\s)]+)([^)]*\))/g, (_, before, value, after) => {
        const bracketed = value.startsWith('<');
        const url = publishedURL(bracketed ? value.slice(1, -1) : value, source);
        return `${before}${bracketed ? `<${url}>` : url}${after}`;
      })
      .replace(/^(\s{0,3}\[[^\]\n]+\]:\s*)(<?)(\S+?)(>?)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/gm,
        (_, before, open, value, close, title = '') => `${before}${open}${publishedURL(value, source)}${close}${title}`)
      .replace(/\b(href|src)=("|')([^"']+)\2/g,
        (_, name, quote, value) => `${name}=${quote}${publishedURL(value, source)}${quote}`);
  }).join('');
}

function rewriteMarkdown(markdown, source) {
  let fence = null;
  // The archived draft has a 37-entry #p… table of contents but no heading IDs.
  // Its immutable source order pairs those entries with its h2/h3 sections.
  const legacy = source === 'docs/reference/design-v0.3.md';
  const legacyAnchors = legacy ? Array.from(markdown.split('\n')[0].matchAll(/\[[^\]]+\]\(#(p[\w-]*)\)/g), match => match[1]) : [];
  let legacySection = 0;
  const rewritten = markdown.split(/(?<=\n)/).map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*$/.test(line.slice(marker[0].length))) fence = null;
      return line;
    }
    if (marker) { fence = marker[1]; return line; }
    if (legacy && /^#{2,3} /.test(line)) {
      const id = legacyAnchors[legacySection++];
      if (!id) throw new Error('Archived draft headings no longer match its table of contents.');
      line = `${line.trimEnd()} {#${id}}\n`;
    }
    return rewriteInline(line, source);
  }).join('');
  if (legacy && legacySection !== legacyAnchors.length) throw new Error('Archived draft table of contents has unmatched anchors.');
  return rewritten;
}

async function write(relative, contents) {
  const destination = path.join(generated, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

// This path is derived from this script, independent of the caller's working directory.
await stat(path.join(root, 'site/index.md'));
await rm(generated, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
for (const [source, output] of pages) {
  await write(output, rewriteMarkdown(await readFile(path.join(root, source), 'utf8'), source));
}
for (const [source, { page, language }] of sourcePages) {
  const contents = await readFile(path.join(root, source), 'utf8');
  const longest = Math.max(2, ...Array.from(contents.matchAll(/`+/g), match => match[0].length));
  const fence = '`'.repeat(longest + 1);
  await write(page, `# ${source}\n\n仓库开发文件的只读副本。网站不执行此文件；运行方式见[工作环境](/docs/development)。\n\n${fence}${language}\n${contents.trimEnd()}\n${fence}\n`);
}
for (const [source, output] of assets) {
  const destination = path.join(publicDir, output);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, source), destination);
}

const descriptions = {
  '01-us01-roundtrip': '单 Agent 往返、覆盖、合并与批注确认',
  '02-us03-overflow-reject': '预算超额拒绝与显式让位',
  '03-batch-receipts-and-checks': '幂等回执、复核与恢复边界',
  '04-patch-and-subtree': '补丁、子树、撤下与重新纳入',
  '05-operation-boundaries': '操作适用范围与拒绝边界',
  '06-state-overview': '状态概览、差异与渲染失败',
};
await write('conformance/cases/index.md', `# 一致性用例\n\n六组 YAML 是待实现的验收材料。文档站提供原始文件下载；可交互原型通过的内存断言不代表产品 CLI 已完成。范围与实施次序见[决策记录](/docs/decisions)。\n\n| 用例 | 验证范围 |\n| --- | --- |\n${cases.map(file => {
  const filename = path.basename(file);
  return `| [${filename}](/${file}) | ${descriptions[filename.replace(/\.ya?ml$/, '')] || filename} |`;
}).join('\n')}\n`);

console.log(`Prepared ${pages.size + sourcePages.size + 1} pages and ${assets.size} public files in site/.generated.`);
