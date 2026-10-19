// B · 时间展开的过渡：只插值几何（位置、粗细、透明度），份额、文字与状态都是终值，在节拍上换。
// A scene holds keyed maps of plain numeric records; static attributes (colour, text, times) live in
// scene.meta and are never interpolated. A transition samples from whatever is on screen, so a new
// frame, an answer or a hover interrupts the running one without a jump.
//
// 第三轮（b-motion.md）：换轮分两段。
//   走（walk）：时间从上一轮的此刻走到这一轮的此刻；条带以此刻为原点，所以此刻之后的刻度（期限、你定的时间、下一次
//     整理的虚线）按自己的时刻朝此刻线流过来，越近走得越快。别的都不动。
//   之后从切点起按节拍表（BEATS）分组：离场 → 移位 → 进场，每组一个时间窗、各走一段；cue 在固定时刻触发一次
//     （切点换字、回执填实、英雄数字、标签落定、新问题描红），由宿主执行。
// 往回、拖动、展开小事等用 uniform：所有元素在同一个窗里走，与第二轮的过渡相同。
import { futureFraction } from './b-layout.mjs?v=b-temporal-2';

const clamp = value => Math.max(0, Math.min(1, value));
const mix = (a, b, t) => a + (b - a) * t;
const HOUR = 3600000;

// cubic-bezier(.22, .68, .32, 1): quick start, long soft landing — reads as growth, not travel.
const bez = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
export function ease(time) {
  let lo = 0, hi = 1;
  for (let step = 0; step < 18; step += 1) { const mid = (lo + hi) / 2; if (bez(mid, .22, .32) < time) lo = mid; else hi = mid; }
  return bez((lo + hi) / 2, .68, 1);
}
/** Out-cubic, no overshoot: lists and bands that are being read never bounce. */
export const easeOut = k => 1 - (1 - clamp(k)) ** 3;

/**
 * Beat tables (seconds from the cut). Same schedule as D 手机首页 (home-motion.md 4.3) so the two answering forms move alike.
 *   exit / stay / enter  [start, duration] of each group; stagger between entering items (at most staggerMax of them)
 *   cues                 one-off moments the host acts on: cut (texts), ack (receipts fill), hero (the big number),
 *                        land (labels and numbers turn to their new values), flash (a new question outlined once)
 */
export const BEATS = {
  turn: { exit: [0.40, 0.24], stay: [0.48, 0.32], enter: [0.60, 0.36], stagger: 0.04, staggerMax: 8,
    cues: { cut: 0, ack: 0, hero: 0.40, land: 0.80, flash: 0.96 }, end: 1.0 },
  answer: { exit: [0, 0.12], stay: [0.20, 0.32], enter: [0.10, 0.20], stagger: 0, staggerMax: 0, cues: { cut: 0, land: 0.10, hero: 0.20 }, end: 0.52 },
  undo: { exit: [0, 0.15], stay: [0.10, 0.20], enter: [0.15, 0.20], stagger: 0, staggerMax: 0, cues: { cut: 0, land: 0.15, hero: 0.15 }, end: 0.35 },
};
/** All groups in one window: back steps, dragging, 小事, ranges, layers (the second round's transition). */
export function uniform(ms) {
  const d = Math.max(0, ms) / 1000;
  return { uniform: true, exit: [0, d], stay: [0, d], enter: [0, d], stagger: 0, staggerMax: 0, cues: { cut: 0, ack: 0, hero: 0, land: 0, flash: 0 }, end: d };
}
/** How long the walk takes for a span of time: 12 hours in 0.40 s, never under 0.18 s or over 0.9 s. */
export const walkSeconds = span => Math.max(0.18, Math.min(0.9, 0.40 * Math.sqrt(Math.max(0, span) / (12 * HOUR))));

const MAPS = ['nodes', 'bars', 'lanes', 'ticks', 'labels', 'marks', 'merges', 'leaders', 'nexts', 'hero'];
const appear = record => ({ ...record, o: 0 });
const ENTER = {
  bars: record => ({ ...record, y: record.y + record.h / 2, h: 0, o: record.o }),
  lanes: record => ({ ...record, y: record.y + record.h / 2, h: 0, o: 0 }),
  ticks: record => ({ ...record, o: 0 }),
  labels: appear, marks: appear, merges: appear, nodes: appear, leaders: appear, nexts: appear,
  hero: record => ({ ...record, x: 0, o: 0 }),
};
const EXIT = {
  bars: record => ({ ...record, y: record.y + record.h / 2, h: 0 }),
  lanes: record => ({ ...record, y: record.y + record.h / 2, h: 0, o: 0 }),
  ticks: record => ({ ...record, o: 0 }),
  labels: appear, marks: appear, merges: appear, nodes: appear, leaders: appear, nexts: appear,
  hero: record => ({ ...record, x: 0, o: 0 }),
};

function nodeX(scene, index) {
  const own = scene.nodes.get(index);
  if (own) return own.x;
  const keys = [...scene.nodes.keys()];
  if (!keys.length) return 0;
  const first = Math.min(...keys), last = Math.max(...keys);
  return scene.nodes.get(index < first ? first : last).x;
}
// A band's point at a node the scene does not show: the nearest shown point, slid to that node's x.
function pointAt(scene, band, index) {
  if (band.pts.has(index)) return band.pts.get(index);
  const keys = [...band.pts.keys()];
  const nearest = keys.reduce((best, key) => Math.abs(key - index) < Math.abs(best - index) ? key : best, keys[0]);
  return { ...band.pts.get(nearest), x: nodeX(scene, index) };
}
// Which item a record belongs to, for the stagger of entering items ("due:id", "chk:id" → id).
const itemOf = (name, key) => (name === 'ticks' ? String(key).replace(/^[a-z]+:/, '') : String(key));

// Uniform plans stage opacity so two texts never share a place: what leaves is gone in the first third,
// what arrives fades in over the second half. Phased plans give each group its own window instead.
const stage = (state, t) => state === 'exit' ? clamp(t / .34) : state === 'enter' ? clamp((t - .42) / .58) : t;
function mixRecord(a, b, t, state = 'stay', raw = t, staged = false) {
  const out = {};
  for (const key in b) out[key] = typeof b[key] === 'number' && typeof a[key] === 'number' ? mix(a[key], b[key], key === 'o' && staged && state !== 'stay' ? stage(state, raw) : t) : b[key];
  return out;
}

/**
 * from → to on a plan (BEATS.* or uniform(ms)); sample(seconds since the tween began).
 * The old API `sample(progress, linear)` (0..1 of a uniform tween) is kept as sampleProgress.
 */
export function makeTween(from, to, plan = uniform(340)) {
  const pairs = {};
  for (const name of MAPS) {
    const a = from[name] || new Map(), b = to[name] || new Map();
    pairs[name] = [...new Set([...a.keys(), ...b.keys()])].map(key => {
      let start = a.get(key) ?? ENTER[name](b.get(key)), end = b.get(key) ?? EXIT[name](a.get(key));
      // A label whose item sinks into 小事 travels to the 小事 label; one that rises out starts there.
      if (name === 'labels' && !b.has(key) && to.members?.has(key) && b.has('__small__')) end = { ...end, y: b.get('__small__').y };
      if (name === 'labels' && !a.has(key) && from.members?.has(key) && a.has('__small__')) start = { ...start, y: a.get('__small__').y };
      return [key, start, end, a.has(key) ? (b.has(key) ? 'stay' : 'exit') : 'enter'];
    });
  }
  const bands = [...new Set([...from.bands.keys(), ...to.bands.keys()])].map(key => {
    const a = from.bands.get(key), b = to.bands.get(key);
    const indexes = [...new Set([...(a?.pts.keys() || []), ...(b?.pts.keys() || [])])].sort((x, y) => x - y);
    const points = indexes.map(index => {
      let start, end;
      if (a) start = pointAt(from, a, index);
      if (b) end = pointAt(to, b, index);
      if (!start) start = { ...end, x: nodeX(from, index), y: end.y + end.h / 2, h: 0 };
      if (!end) end = { ...start, x: nodeX(to, index), y: start.y + start.h / 2, h: 0 };
      return [index, start, end];
    });
    return [key, points, a ? 1 : 0, b ? 1 : 0, a ? (b ? 'stay' : 'exit') : 'enter'];
  });
  // Entering items take turns, top to bottom, 40 ms apart (at most staggerMax of them).
  const delay = new Map();
  if (plan.stagger) {
    const entering = [...new Set(pairs.labels.concat(pairs.bars).filter(p => p[3] === 'enter').map(p => String(p[0])))]
      .map(id => ({ id, y: to.bars?.get(id)?.y ?? to.labels?.get(id)?.y ?? 0 })).sort((p, q) => p.y - q.y);
    entering.forEach((entry, n) => delay.set(entry.id, Math.min(n, plan.staggerMax) * plan.stagger));
  }
  const at = (state, seconds, key, name) => {
    const [s, d] = plan[state] || plan.stay;
    const lag = state === 'enter' ? delay.get(itemOf(name, key)) || 0 : 0;
    return d > 0 ? clamp((seconds - s - lag) / d) : seconds >= s ? 1 : 0;
  };
  const shape = k => (plan.uniform ? (k >= 1 ? 1 : ease(k)) : easeOut(k));
  // The structure drawn during the tween: every key either side has, with the target's meta.
  const template = { ...to, meta: mergeMeta(from.meta, to.meta) };
  for (const name of MAPS) template[name] = new Map(pairs[name].map(([key, , end]) => [key, end]));
  template.bands = new Map(bands.map(([key]) => [key, to.bands.get(key) || from.bands.get(key)]));
  const duration = plan.end + (plan.stagger ? Math.min(plan.staggerMax, delay.size) * plan.stagger : 0);
  function sample(seconds) {
    const kStay = at('stay', seconds), t = shape(kStay);
    const scene = { ...to, meta: template.meta, width: mix(from.width, to.width, t), height: mix(from.height, to.height, t), scrollLeft: mix(from.scrollLeft ?? 0, to.scrollLeft ?? 0, t) };
    for (const name of MAPS) scene[name] = new Map(pairs[name].map(([key, start, end, state]) => {
      const raw = at(plan.uniform ? 'stay' : state, seconds, key, name);
      return [key, mixRecord(start, end, shape(raw), state, raw, plan.uniform)];
    }));
    scene.bands = new Map(bands.map(([key, points, oa, ob, state]) => {
      const k = shape(at(plan.uniform ? 'stay' : state, seconds));
      return [key, { pts: new Map(points.map(([index, s, e]) => [index, mixRecord(s, e, k)])), o: mix(oa, ob, k) }];
    }));
    for (const key of ['blankY', 'blankH']) if (typeof to[key] === 'number') scene[key] = mix(from[key] ?? to[key], to[key], t);
    scene.done = seconds >= duration;
    return scene;
  }
  return {
    template, duration, sample,
    /** 0..1 of the whole tween (review tooling and the old callers). */
    sampleProgress(progress) { return sample(clamp(progress) * duration); },
  };
}
function mergeMeta(a = {}, b = {}) {
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[key], y = b[key];
    out[key] = x instanceof Map || y instanceof Map ? new Map([...(x || []), ...(y || [])]) : y ?? x;
  }
  return out;
}

/**
 * The walk: `from` as time goes from t0 to t1. Every record whose meta carries a time (`at`) slides to where that time
 * now falls on the strip after now; the rest stays. Starting from what is on screen: a record that was mid-way when this
 * walk began blends from its drawn x to the exact place, so an interruption never jumps.
 * sample(k) → a scene, with `time` (the walked moment) and `crossed` (keys whose time has reached now).
 */
export function makeWalk(from, t0, t1) {
  const W = from.futureW || 1, fx = span => futureFraction(span) * W;
  const lerpTime = k => t0 + (t1 - t0) * k;
  const moving = (map, metas) => [...(map || new Map())].map(([key, record]) => {
    const at = metas?.get(key)?.at;
    if (!(typeof at === 'number')) return [key, record, null];
    const x0 = fx(at - t0), x1 = fx(at - t1);
    return [key, record, { at, x0, x1, answered: Boolean(metas.get(key).answered) }];
  });
  const ticks = moving(from.ticks, from.meta?.ticks), nexts = moving(from.nexts, from.meta?.nexts);
  const heroAt = from.meta?.hero?.at;
  const place = (record, info, t) => {
    if (!info) return record;
    const exact = fx(info.at - t);
    const x = Math.abs(info.x1 - info.x0) < 0.01 ? record.x : record.x + (info.x1 - record.x) * ((exact - info.x0) / (info.x1 - info.x0) || 0);
    // A deadline you have answered here passes through now and goes; nothing is left on the line.
    const o = info.answered && info.at <= t ? record.o * clamp(1 - (t - info.at) / (1.5 * HOUR)) : record.o;
    return { ...record, x: Number.isFinite(x) ? Math.max(0, x) : record.x, o };
  };
  return {
    t0, t1,
    sample(k) {
      const t = lerpTime(clamp(k));
      const crossed = new Set();
      const scene = { ...from, time: t, crossed };
      scene.ticks = new Map(ticks.map(([key, record, info]) => { if (info && info.at <= t && info.at > t0) crossed.add(key); return [key, place(record, info, t)]; }));
      scene.nexts = new Map(nexts.map(([key, record, info]) => [key, place(record, info, t)]));
      if (from.hero?.has('hero')) {
        const hero = from.hero.get('hero');
        const x = typeof heroAt === 'number' ? Math.max(0, hero.x + (fx(heroAt - t) - fx(heroAt - t0))) : hero.x;
        scene.hero = new Map([['hero', { ...hero, x }]]);
      }
      return scene;
    },
  };
}

/**
 * prepare(template, plan) creates/removes elements for the union of keys; draw(scene) writes attributes;
 * cue(name, target) acts on one beat; tick(ms) is called by the host's frame loop (the module owns no rAF), wake() asks
 * for that loop to run. Returns { transition(scene, { duration, instant, plan, walk }), tick, settle(), stop(), hold(on),
 * pin(seconds|null), seek(ms), replay(), running, visual, phase, stats }.
 */
export function createTimeMotion({ prepare, draw, complete, status, reduced, cue = () => {}, wake = () => {} }) {
  let visual = null, target = null, last = null, active = null, held = false, pinned = null;
  const stats = { frames: 0, total: 0, worst: 0, samples: [] };
  // Cues not yet fired when a transition is cut short still happen, at once, so texts end on the latest target.
  function flush() {
    if (!active) return;
    for (const [name] of Object.entries(active.plan.cues).sort((a, b) => a[1] - b[1])) if (!active.fired.has(name)) { active.fired.add(name); cue(name, active.target, active); }
  }
  function finish() {
    if (!active) return;
    flush();
    const done = active;
    active = null;
    visual = done.target; prepare(done.target, null); draw(done.target); complete?.(done.target, done);
    status?.('idle', 1);
  }
  function settle() { if (active) finish(); else if (target) { visual = target; prepare(target, null); draw(target); complete?.(target, null); } }
  function stop() { flush(); active = null; }
  function transition(next, { duration = 340, instant = false, remember = true, plan = null, walk = null, kind = 'other' } = {}) {
    if (active) { flush(); }
    target = next;
    const chosen = plan || uniform(duration);
    if (!visual || instant || reduced() || (chosen.uniform && chosen.end <= 0 && !walk)) {
      active = { target: next, plan: chosen, fired: new Set(), kind };
      flush(); active = null;
      visual = target; prepare(target, null); draw(target); complete?.(target, null); status?.(reduced() ? 'reduced' : 'idle', 1);
      return;
    }
    const from = visual;
    const walker = walk && walk.t1 > walk.t0 ? makeWalk(from, walk.t0, walk.t1) : null;
    const W = walker ? (walk.seconds ?? walkSeconds(walk.t1 - walk.t0)) : 0;
    active = { target: next, from, plan: chosen, walker, W, tween: null, elapsed: 0, fired: new Set(), kind };
    if (remember) last = { from, target: next };
    if (!walker) startTween();
    status?.(walker ? 'walk' : 'running', 0);
    wake();
  }
  function startTween() {
    const a = active;
    const from = a.walker ? a.walker.sample(1) : a.from;
    a.tween = makeTween(from, a.target, a.plan);
    prepare(a.tween.template, a.plan);
  }
  function frameAt(seconds) {
    const a = active;
    if (a.walker && seconds < a.W) {
      a.phase = 'walk';
      return a.walker.sample(easeOut(seconds / a.W));
    }
    if (!a.tween) startTween();
    a.phase = 'beats';
    const tau = seconds - a.W;
    for (const [name, when] of Object.entries(a.plan.cues).sort((p, q) => p[1] - q[1])) if (!a.fired.has(name) && tau >= when) { a.fired.add(name); cue(name, a.target, a); }
    a.tau = tau;
    return a.tween.sample(tau);
  }
  function tick(dtMs) {
    if (!active) return false;
    const t0 = performance.now(), a = active;
    if (pinned == null && !held) a.elapsed += Math.min(100, dtMs) / 1000;
    const seconds = pinned ?? a.elapsed;
    const scene = frameAt(seconds);
    if (active !== a) return Boolean(active); // a cue started another transition (or ended this one)
    visual = scene; draw(visual);
    const cost = performance.now() - t0;
    stats.frames += 1; stats.total += cost; stats.worst = Math.max(stats.worst, cost);
    if (stats.samples.length < 4000) stats.samples.push(cost);
    status?.(active.phase === 'walk' ? 'walk' : 'running', clamp(seconds / (active.W + (active.tween?.duration || active.plan.end))));
    if (pinned == null && active.phase === 'beats' && scene.done) { finish(); return false; }
    return true;
  }
  return {
    transition, tick, settle, stop, stats,
    hold(on) { held = Boolean(on); if (!held) wake(); },
    /** Review tooling: hold the running transition at `seconds` after its start (walk included); null lets it run. */
    pin(seconds) { pinned = seconds == null ? null : Math.max(0, Number(seconds)); if (active) { if (pinned != null) { const s = frameAt(pinned); if (active) { visual = s; draw(s); } } wake(); } },
    seek(ms) { if (!active) return false; this.pin(ms / 1000); return true; },
    replay() {
      if (!last || reduced()) return;
      const { from, target: to } = last;
      visual = from; prepare(from, null); draw(from);
      transition(to, { plan: uniform(600), remember: false });
    },
    get running() { return Boolean(active); },
    get held() { return held; },
    get pinned() { return pinned; },
    get phase() { return active ? (active.phase || (active.walker ? 'walk' : 'beats')) : 'idle'; },
    get active() { return active; },
    get canReplay() { return Boolean(last) && !reduced(); },
    get visual() { return visual; },
  };
}
