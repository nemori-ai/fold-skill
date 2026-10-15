// B · 时间展开的过渡：只插值几何（位置、粗细、透明度），份额、文字与状态直接是终值。
// A scene holds keyed maps of plain numeric records; static attributes (colour, text) live in
// scene.meta and are never interpolated. A transition samples from whatever is on screen, so a
// new frame interrupts the running one without a jump.
const clamp = value => Math.max(0, Math.min(1, value));
const mix = (a, b, t) => a + (b - a) * t;

// cubic-bezier(.22, .68, .32, 1): quick start, long soft landing — reads as growth, not travel.
const bez = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
export function ease(time) {
  let lo = 0, hi = 1;
  for (let step = 0; step < 18; step += 1) { const mid = (lo + hi) / 2; if (bez(mid, .22, .32) < time) lo = mid; else hi = mid; }
  return bez((lo + hi) / 2, .68, 1);
}

const MAPS = ['nodes', 'bars', 'lanes', 'ticks', 'labels', 'marks', 'merges', 'leaders'];
function mixRecord(a, b, t, state = 'stay', raw = t) {
  const out = {};
  for (const key in b) out[key] = typeof b[key] === 'number' && typeof a[key] === 'number' ? mix(a[key], b[key], key === 'o' && state !== 'stay' ? stage(state, raw) : t) : b[key];
  return out;
}
const appear = record => ({ ...record, o: 0 });
const ENTER = {
  bars: record => ({ ...record, y: record.y + record.h / 2, h: 0, o: record.o }),
  lanes: record => ({ ...record, y: record.y + record.h / 2, h: 0, o: 0 }),
  ticks: record => ({ ...record, x: 0, o: 0 }),
  labels: appear, marks: appear, merges: appear, nodes: appear, leaders: appear,
};
const EXIT = {
  bars: record => ({ ...record, y: record.y + record.h / 2, h: 0 }),
  lanes: record => ({ ...record, y: record.y + record.h / 2, h: 0, o: 0 }),
  ticks: record => ({ ...record, o: 0 }),
  labels: appear, marks: appear, merges: appear, nodes: appear, leaders: appear,
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

// Opacity is staged so two texts never share a place: what leaves is gone in the first third,
// what arrives fades in over the second half. Geometry runs over the whole duration.
const stage = (state, t) => state === 'exit' ? clamp(t / .34) : state === 'enter' ? clamp((t - .42) / .58) : t;
export function makeTween(from, to) {
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
    return [key, points, a ? 1 : 0, b ? 1 : 0];
  });
  // The structure drawn during the tween: every key either side has, with the target's meta.
  const template = { ...to, meta: mergeMeta(from.meta, to.meta) };
  for (const name of MAPS) template[name] = new Map(pairs[name].map(([key, , end]) => [key, end]));
  template.bands = new Map(bands.map(([key]) => [key, to.bands.get(key) || from.bands.get(key)]));
  return {
    template,
    sample(progress, linear = progress) {
      const t = clamp(progress), raw = clamp(linear);
      const scene = { ...to, meta: template.meta, width: mix(from.width, to.width, t), height: mix(from.height, to.height, t), scrollLeft: mix(from.scrollLeft ?? 0, to.scrollLeft ?? 0, t) };
      for (const name of MAPS) scene[name] = new Map(pairs[name].map(([key, start, end, state]) => [key, mixRecord(start, end, t, state, raw)]));
      scene.bands = new Map(bands.map(([key, points, oa, ob]) => [key, { pts: new Map(points.map(([index, s, e]) => [index, mixRecord(s, e, t)])), o: mix(oa, ob, t) }]));
      for (const key of ['nextX', 'blankY', 'blankH']) if (typeof to[key] === 'number') scene[key] = mix(from[key] ?? to[key], to[key], t);
      return scene;
    },
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
 * prepare(template) creates/removes elements for the union of keys; draw(scene) writes attributes.
 * Returns { transition(scene, { duration, instant }), settle(), stop(), replay(), running, visual, stats }.
 */
export function createTimeMotion({ prepare, draw, complete, status, reduced }) {
  let visual = null, target = null, raf = null, last = null, active = null;
  const stats = { frames: 0, total: 0, worst: 0, samples: [] };
  const stop = () => { if (raf !== null) cancelAnimationFrame(raf); raf = null; };
  function settle() {
    stop(); if (!target) return;
    visual = target; prepare(target); draw(target); complete?.(target); status?.('idle', 1);
  }
  function transition(next, { duration = 340, instant = false, remember = true } = {}) {
    stop(); target = next;
    if (!visual || instant || reduced() || duration <= 0) {
      visual = target; prepare(target); draw(target); complete?.(target); status?.(reduced() ? 'reduced' : 'idle', 1);
      return;
    }
    const from = visual;
    const tween = makeTween(from, target);
    active = { tween, duration };
    if (remember) last = { from, target, duration };
    prepare(tween.template);
    const started = performance.now();
    status?.('running', 0);
    const tick = now => {
      const t0 = performance.now();
      const elapsed = clamp((now - started) / duration);
      visual = tween.sample(elapsed >= 1 ? 1 : ease(elapsed), elapsed); draw(visual);
      const cost = performance.now() - t0;
      stats.frames += 1; stats.total += cost; stats.worst = Math.max(stats.worst, cost);
      if (stats.samples.length < 2000) stats.samples.push(cost);
      status?.('running', elapsed);
      if (elapsed < 1) raf = requestAnimationFrame(tick); else { raf = null; settle(); }
    };
    raf = requestAnimationFrame(tick);
  }
  return {
    transition, settle, stop, stats,
    /** Review tooling: hold the running transition at `ms` after its start (deterministic stills). */
    seek(ms) { if (!active) return false; stop(); visual = active.tween.sample(ease(clamp(ms / active.duration)), clamp(ms / active.duration)); draw(visual); return true; },
    replay() { if (!last || reduced()) return; visual = last.from; transition(last.target, { duration: Math.max(last.duration, 600), remember: false }); },
    get running() { return raf !== null; },
    get canReplay() { return Boolean(last) && !reduced(); },
    get visual() { return visual; },
  };
}
