// 站点展示字体的子集：只给极少的字用网络字体，其余交给系统（规格见 site/landing/style.md「字体」）。
// 收集入口页标题（FoldLanding.vue 里 class 含 fl-h 的元素、六张卡的名字）、各篇文档 h1 与 docs/why.md 的节名和引句用到的字，向 Google Fonts
// 的 css2 接口按 text= 取子集 woff2，存进 site/fonts/（自托管，运行时不请求第三方），并生成带 unicode-range 的
// site/.vitepress/theme/fonts.css。入口页只用得到第一份中文子集；文档 h1 里入口页没有的字放进第二份，只在文档页下载。
// 字体是 SIL Open Font License 1.1，许可全文与版权行一起写进 site/fonts/OFL.txt。
//
//   node scripts/landing-fonts.mjs          # 文案改了字之后重跑，产物入库
//   node scripts/landing-fonts.mjs --check  # 只核对：现有子集是否覆盖了现在的文案，不联网
//
// 需要联网（fonts.googleapis.com、raw.githubusercontent.com）。不加依赖。
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOP } from '../site/.vitepress/theme/landing.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'site/fonts');
const css = path.join(root, 'site/.vitepress/theme/fonts.css');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Characters the serif faces always carry: digits and the punctuation headings use, so a heading never mixes faces.
const BASE = '0123456789，。、：；？！“”（）·—…→ ';
const DISPLAY = '0123456789Fold%+−/.·×'; // Instrument Serif: the big numbers and the wordmark

const strip = html => html.replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '');
const unique = text => [...new Set([...text])].filter(c => !/\s/.test(c)).sort().join('');

export async function landingText() {
  const vue = await readFile(path.join(root, 'site/.vitepress/theme/FoldLanding.vue'), 'utf8');
  const template = vue.slice(vue.indexOf('<template>'), vue.lastIndexOf('</template>'));
  let text = '';
  for (const m of template.matchAll(/<(h[1-3]|p|span|div)\b[^>]*class="[^"]*\bfl-h\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)) text += strip(m[2]);
  text += TOP.map(t => t.name).join('');
  return text;
}

async function walk(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || ['node_modules', 'raw', 'local', 'private'].includes(entry.name)) continue;
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walk(relative));
    else if (entry.name.endsWith('.md')) files.push(relative);
  }
  return files;
}

export async function docsText() {
  // The published pages (scripts/prepare-site.mjs): their first-level headings, plus the generated cases index.
  let text = '一致性用例';
  const files = ['README.md', 'AGENTS.md', ...(await Promise.all(['docs', 'skill', 'corpus', 'prototype'].map(walk))).flat()];
  for (const file of files) {
    const body = await readFile(path.join(root, file), 'utf8');
    const h1 = body.replace(/^---[\s\S]*?\n---\n/, '').match(/^# (.+)$/m);
    if (h1) text += strip(h1[1]);
  }
  return text;
}

// docs/why.md also sets its section titles and the judgments that stand on their own line (> …) in the serif.
export async function whyText() {
  const body = await readFile(path.join(root, 'docs/why.md'), 'utf8');
  return [...body.matchAll(/^(?:#{1,2}|>) (.+)$/gm)].map(m => strip(m[1].replace(/\{#[^}]*\}/g, ''))).join('');
}

function ranges(chars) {
  const points = [...chars].map(c => c.codePointAt(0)).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    let j = i;
    while (j + 1 < points.length && points[j + 1] === points[j] + 1) j += 1;
    const hex = n => n.toString(16).toUpperCase();
    out.push(i === j ? `U+${hex(points[i])}` : `U+${hex(points[i])}-${hex(points[j])}`);
    i = j;
  }
  return out.join(', ');
}

async function subset(family, text, file) {
  const url = `https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}&display=swap`;
  const sheet = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const src = sheet.match(/src:\s*url\(([^)]+)\)\s*format\('woff2'\)/);
  if (!src) throw new Error(`No woff2 for ${family}:\n${sheet.slice(0, 400)}`);
  const font = Buffer.from(await (await fetch(src[1], { headers: { 'User-Agent': UA } })).arrayBuffer());
  await writeFile(path.join(out, file), font);
  return font.length;
}

const manifestPath = path.join(out, 'subset.json');
const landing = unique(BASE + await landingText());
const why = unique(await whyText());
const docsAll = unique(BASE + await docsText() + why);
const docsOnly = [...docsAll].filter(c => !landing.includes(c)).join('');

if (process.argv.includes('--check')) {
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : { landing: '', docs: '' };
  const missing = [...landing].filter(c => !manifest.landing.includes(c));
  const missingDocs = [...docsOnly].filter(c => !manifest.landing.includes(c) && !manifest.docs.includes(c));
  if (missing.length) { console.error(`入口页标题有 ${missing.length} 个字不在子集里：${missing.join('')}；重跑 node scripts/landing-fonts.mjs`); process.exit(1); }
  const missingWhy = [...why].filter(c => !manifest.landing.includes(c) && !manifest.docs.includes(c));
  if (missingWhy.length) { console.error(`docs/why.md 的标题与引句有 ${missingWhy.length} 个字不在子集里：${missingWhy.join('')}；重跑 node scripts/landing-fonts.mjs`); process.exit(1); }
  if (missingDocs.length) console.warn(`文档 h1 有 ${missingDocs.length} 个字不在子集里（回落到系统宋体）：${missingDocs.join('')}`);
  console.log(`字体子集覆盖入口页标题的 ${landing.length} 个字。`);
  process.exit(0);
}

await mkdir(out, { recursive: true });
const sizes = {
  display: await subset('Instrument+Serif', DISPLAY, 'instrument-serif.woff2'),
  landing: await subset('Noto+Serif+SC:wght@700', landing, 'fold-serif-sc-landing.woff2'),
  docs: docsOnly ? await subset('Noto+Serif+SC:wght@700', docsOnly, 'fold-serif-sc-docs.woff2') : 0,
};
const license = async (dir, name) => (await (await fetch(`https://raw.githubusercontent.com/google/fonts/main/ofl/${dir}/OFL.txt`)).text()).trim();
await writeFile(path.join(out, 'OFL.txt'), `本目录的字体子集以 SIL Open Font License 1.1 发布，下面是两份原许可全文。
- instrument-serif.woff2：Instrument Serif（Regular）的子集，只含数字与 Fold 字标用到的字形。
- fold-serif-sc-*.woff2：Noto Serif SC（Bold）的子集，只含站点标题用到的字，在站点 CSS 里以 Fold Serif SC 的名字使用。
子集由 scripts/landing-fonts.mjs 从 Google Fonts 生成。

==== Instrument Serif ====
${await license('instrumentserif')}

==== Noto Serif SC ====
${await license('notoserifsc')}
`);
await writeFile(manifestPath, `${JSON.stringify({ note: 'scripts/landing-fonts.mjs 生成；改了标题文案后重跑', display: DISPLAY, landing, docs: docsOnly, bytes: sizes }, null, 2)}\n`);
await writeFile(css, `/* Generated by scripts/landing-fonts.mjs: self-hosted subsets (SIL OFL 1.1, site/fonts/OFL.txt). */
@font-face {
  font-family: "Instrument Serif";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/instrument-serif.woff2") format("woff2");
  unicode-range: ${ranges(DISPLAY)};
}

/* The landing's headings: the only Chinese webfont the landing page loads. */
@font-face {
  font-family: "Fold Serif SC";
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("/fonts/fold-serif-sc-landing.woff2") format("woff2");
  unicode-range: ${ranges(landing)};
}
${docsOnly ? `
/* Characters only the documents' titles use; downloaded on those pages alone. */
@font-face {
  font-family: "Fold Serif SC";
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("/fonts/fold-serif-sc-docs.woff2") format("woff2");
  unicode-range: ${ranges(docsOnly)};
}
` : ''}`);
console.log(`字体子集：Instrument Serif ${DISPLAY.length} 字 ${sizes.display} B；入口页标题 ${landing.length} 字 ${sizes.landing} B；文档 h1 另 ${docsOnly.length} 字 ${sizes.docs} B。`);
