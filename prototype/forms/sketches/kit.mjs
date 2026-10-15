// Shared helpers for the round-two sketches. Each sketch renders one chosen frame of the
// same replay, as a static 1440×900 page: no frame stepping, no interaction.
import { scenario, records, escapeHTML, formatDate, formatTime } from '../../variants/shared.mjs?v=feedback-loop-1';
import { kit as formKit } from '../shell.mjs';

export { scenario, records, formatTime };
const esc = escapeHTML;
export const frames = scenario.frames;
export const personName = scenario.persona?.short || scenario.persona?.name || '你';

// Root identity colours, shared with the two-week small multiples.
export const identityColors = formKit.identityColors;
// Stable short names: the category labels from the replay, and two-character tags for tight spots.
export const categoryName = id => scenario.categories[id]?.label || id;
export const shortName = new Proxy({}, { get: (_, id) => scenario.categories?.[id]?.short || scenario.categories?.[id]?.label || id });

// Parent links never change in this replay, so one map covers every snapshot.
const parentOf = new Map();
for (const record of records) for (const item of Object.values(record.snapshot.items)) parentOf.set(item.id, item.parent_id);
export function rootOf(id) {
  let current = id;
  const seen = new Set();
  while (parentOf.get(current) && !seen.has(current)) { seen.add(current); current = parentOf.get(current); }
  return current;
}

export const at = index => Date.parse(frames[index].at);

// The hand-written story is where each sketch's chosen frame and its explanation were written.
// Other datasets take ?frame= (index or frame id) or, by default, a frame named in the dataset's
// `sketchFrames`, else the last frame; the story-specific explanation is then replaced by a note.
export const isStory = scenario.id === 'shanghai-two-weeks';
export function chosenFrame(name, storyIndex) {
  const asked = new URLSearchParams(location.search).get('frame');
  if (asked != null) {
    const byId = frames.findIndex(frame => frame.id === asked);
    const index = byId >= 0 ? byId : Number(asked);
    if (Number.isInteger(index) && index >= 0 && index < frames.length) return index;
  }
  if (isStory) return storyIndex;
  const named = scenario.sketchFrames?.[name];
  const index = named ? frames.findIndex(frame => frame.id === named) : -1;
  return index >= 0 ? index : frames.length - 1;
}
const dayTime = value => `${formatDate(value)} ${formatTime(value)}`;
export const dayOf = value => Number(new Intl.DateTimeFormat('en-US', { timeZone: scenario.timeZone || 'Asia/Shanghai', day: 'numeric' }).format(new Date(value)));
const hourOf = value => Number(new Intl.DateTimeFormat('en-US', { timeZone: scenario.timeZone || 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' }).format(new Date(value)));
/** Whole-hour instants between t0 and t1 whose local hour (dataset time zone) is `hour`. */
export function localHours(t0, t1, hour) {
  const out = [];
  for (let t = Math.ceil(t0 / 3600000) * 3600000; t <= t1; t += 3600000) if (hourOf(t) === hour) out.push(t);
  return out;
}
export const monthDay = value => new Intl.DateTimeFormat('en-US', { timeZone: scenario.timeZone || 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).format(new Date(value));
export const weekdayOf = value => new Intl.DateTimeFormat('zh-CN', { timeZone: scenario.timeZone || 'Asia/Shanghai', weekday: 'short' }).format(new Date(value));

// One page frame for all five sketches: kicker, the main relation, the chosen frame, a key.
export function page({ no, name, relation, index, why, key }) {
  const frame = frames[index], record = records[index];
  const sketchId = location.pathname.split('/').pop().replace(/\.html$/, '');
  const asked = new URLSearchParams(location.search).has('frame');
  if (!isStory) why = (!asked && scenario.sketchNotes?.[sketchId]) || '选用帧说明是为手写情境写的；当前数据集取默认帧，可用 ?frame= 指定。';
  document.title = `Fold · 草图 ${no} ${name}`;
  document.body.innerHTML = `<div class="sk">
    <header class="sk-head">
      <div class="sk-kicker"><a href="../index.html">FOLD · 第二轮草图</a> <b>${String(no).padStart(2, '0')}</b> ${esc(name)}</div>
      <h1>${esc(relation)}</h1>
      <p class="sk-frame"><span>选用帧 <b>${esc(frame.id)}</b> · ${esc(dayTime(frame.at))} · ${esc(record.state.revision)}</span><span class="sk-frame-title">「${esc(frame.title)}」</span><span class="sk-why">${esc(why)}</span></p>
    </header>
    <main class="sk-figure" id="figure"></main>
    <footer class="sk-key">${key}</footer>
  </div>`;
  return document.getElementById('figure');
}

// Text width for wrapping decisions, measured with the page's own font stack.
const canvas = document.createElement('canvas').getContext('2d');
export function textWidth(text, size, weight = 400, family = getComputedStyle(document.body).fontFamily) {
  canvas.font = `${weight} ${size}px ${family}`;
  return canvas.measureText(text).width;
}
// Fit text into a width: one line (allowing a slight shrink), else two lines split at the
// punctuation nearest the middle, else a smaller single line, else an ellipsis.
export function fitText(text, width, size, { twoLines = false, minSize = 9.5, weight = 400 } = {}) {
  const fits = (t, s) => textWidth(t, s, weight) <= width;
  if (fits(text, size)) return { lines: [text], size };
  if (fits(text, size - 1)) return { lines: [text], size: size - 1 };
  if (twoLines) {
    // Never cut inside a run of Latin letters or digits ("6400", "INP").
    const chars = [...text], mid = chars.length / 2;
    const cuts = chars.map((c, k) => k + 1)
      .filter(k => k > 1 && k < chars.length - 1 && !(/[\w.]/.test(chars[k - 1]) && /[\w.]/.test(chars[k])));
    const split = (pool, s) => {
      const ok = pool.filter(k => fits(chars.slice(0, k).join(''), s) && fits(chars.slice(k).join(''), s));
      if (!ok.length) return null;
      const k = ok.reduce((best, x) => (Math.abs(x - mid) < Math.abs(best - mid) ? x : best));
      return { lines: [chars.slice(0, k).join(''), chars.slice(k).join('')], size: s };
    };
    const punct = cuts.filter(k => /[，：、；,:]/.test(chars[k - 1]));
    const best = split(punct, size) || split(punct, size - 1) || split(cuts, size);
    if (best) return best;
  }
  for (let s = size - 1.5; s >= minSize; s -= 0.5) if (fits(text, s)) return { lines: [text], size: s };
  const chars = [...text];
  while (chars.length > 1 && !fits(`${chars.join('')}…`, minSize)) chars.pop();
  return { lines: [`${chars.join('')}…`], size: minSize };
}

export const svgText = (x, y, text, attrs = '') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${attrs}>${esc(text)}</text>`;
