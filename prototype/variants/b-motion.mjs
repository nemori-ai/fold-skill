// Only visual geometry lives here. Numbers, summaries, and accepted states do not
// acquire intermediate values while their shapes move between real endpoints.

const clamp = value => Math.max(0, Math.min(1, value));
const mix = (a, b, progress) => a + (b - a) * progress;
const union = (a, b) => [...new Set([...a, ...b])];
const cubic = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;

export function easeProgress(time) {
  let lo = 0, hi = 1;
  for (let step = 0; step < 19; step += 1) {
    const middle = (lo + hi) / 2;
    if (cubic(middle, .42, .28) < time) lo = middle;
    else hi = middle;
  }
  return cubic((lo + hi) / 2, 0, 1);
}

function atIndex(scene, id, index) {
  const path = scene.paths.get(id);
  const exact = path?.points.find(point => point.index === index);
  if (exact) return exact;
  const section = scene.sections[index];
  const point = section?.points.get(id) ?? { y: scene.height / 2, height: 0 };
  return { index, x: scene.xFor(index), y: point.y, height: point.height };
}
function edgePoint(scene, id, index) {
  const indexes = [...scene.nodes.keys()];
  const edge = index < Math.min(...indexes) ? Math.min(...indexes) : Math.max(...indexes);
  return { ...atIndex(scene, id, edge), index };
}
const projected = (point, source, destination) => ({ ...point,
  y: destination.y + (point.y - source.y) / Math.max(.01, source.height) * destination.height,
  height: point.height / Math.max(.01, source.height) * destination.height,
});

export function makeTween(from, to, { kind = 'frame', anchorId = null } = {}) {
  const zooming = from.layerId !== to.layerId && (kind === 'dive' || kind === 'rise');
  const pathIds = union(from.paths.keys(), to.paths.keys());
  const nodeIds = union(from.nodes.keys(), to.nodes.keys()).sort((a, b) => a - b);
  const currentIds = union(from.current.keys(), to.current.keys());
  const fromFirst = Math.min(...from.nodes.keys()), fromLast = Math.max(...from.nodes.keys());
  const toFirst = Math.min(...to.nodes.keys()), toLast = Math.max(...to.nodes.keys());
  const pointPairs = new Map();
  for (const id of pathIds) {
    const pairs = nodeIds.map(index => {
      let start = from.paths.get(id)?.points.find(point => point.index === index)
        ?? edgePoint(from, id, index);
      let end = index > toLast ? { ...atIndex(to, id, toLast), index }
        : atIndex(to, id, index);
      if (zooming && !from.paths.has(id)) {
        const parent = kind === 'dive' ? atIndex(from, anchorId, index) : atIndex(to, anchorId, index);
        start = kind === 'dive'
          ? projected(end, { y: 0, height: to.height }, parent)
          : projected(end, parent, { y: 0, height: from.height });
        start.x = index < fromFirst || index > fromLast ? edgePoint(from, anchorId, index).x : from.xFor(index);
      }
      if (zooming && !to.paths.has(id)) {
        const parent = kind === 'dive' ? atIndex(from, anchorId, index) : atIndex(to, anchorId, index);
        end = kind === 'dive'
          ? projected(start, parent, { y: 0, height: to.height })
          : projected(start, { y: 0, height: from.height }, parent);
        end.x = to.xFor(Math.min(index, toLast));
      }
      return { index, start, end };
    });
    pointPairs.set(id, pairs);
  }
  const currentPairs = new Map();
  for (const id of currentIds) {
    const fromPoint = from.current.get(id), toPoint = to.current.get(id);
    const absentFrom = from.section.points.get(id) ?? { y: from.height / 2, height: 0 };
    const absentTo = to.section.points.get(id) ?? { y: to.height / 2, height: 0 };
    let start = fromPoint ?? { ...absentFrom, labelY: absentFrom.y, opacity: 0 };
    let end = toPoint ?? { ...absentTo, labelY: absentTo.y, opacity: 0 };
    if (zooming && !fromPoint) {
      const parent = (kind === 'dive' ? from.current : to.current).get(anchorId)
        ?? { y: 0, height: kind === 'dive' ? from.height : to.height };
      start = kind === 'dive'
        ? projected(end, { y: 0, height: to.height }, parent)
        : projected(end, parent, { y: 0, height: from.height });
      start.labelY = start.y + start.height / 2; start.opacity = 0;
    }
    if (zooming && !toPoint) {
      const parent = (kind === 'dive' ? from.current : to.current).get(anchorId)
        ?? { y: 0, height: kind === 'dive' ? from.height : to.height };
      end = kind === 'dive'
        ? projected(start, parent, { y: 0, height: to.height })
        : projected(start, { y: 0, height: from.height }, parent);
      end.labelY = end.y + end.height / 2; end.opacity = 0;
    }
    currentPairs.set(id, { start, end, wasPresent: Boolean(fromPoint), remains: Boolean(toPoint) });
  }
  const template = {
    ...to,
    paths: new Map(pathIds.map(id => [id, { ...(to.paths.get(id) ?? from.paths.get(id)), id }])),
    current: new Map(currentIds.map(id => [id, { ...(to.current.get(id) ?? from.current.get(id)), id, active: to.current.has(id) }])),
    nodes: new Map(nodeIds.map(index => [index, { ...(to.nodes.get(index) ?? from.nodes.get(index)), active: to.nodes.has(index) }])),
    merges: new Map(union(from.merges.keys(), to.merges.keys()).map(key => [key, to.merges.get(key) ?? from.merges.get(key)])),
  };
  return {
    template,
    sample(progress) {
      const p = clamp(progress);
      const scene = { ...template, width: mix(from.width, to.width, p), height: mix(from.height, to.height, p),
        scrollLeft: mix(from.scrollLeft ?? 0, to.scrollLeft ?? 0, p),
        paths: new Map(), current: new Map(), nodes: new Map(), merges: new Map() };
      for (const id of pathIds) {
        const startOpacity = from.paths.get(id)?.opacity ?? (from.paths.has(id) ? 1 : 0);
        const endOpacity = to.paths.get(id)?.opacity ?? (to.paths.has(id) ? 1 : 0);
        const opacityProgress = !from.paths.has(id) ? clamp((p - .22) / .50)
          : !to.paths.has(id) ? clamp((p - .35) / .45) : p;
        const opacity = mix(startOpacity, endOpacity, opacityProgress);
        scene.paths.set(id, { ...template.paths.get(id), opacity,
          points: pointPairs.get(id).map(({ index, start, end }) => ({ index,
            x: mix(start.x, end.x, p), y: mix(start.y, end.y, p), height: mix(start.height, end.height, p) })) });
      }
      for (const [id, { start, end, wasPresent, remains }] of currentPairs) {
        const opacityProgress = remains && wasPresent ? p : remains ? clamp((p - .16) / .50) : clamp(p / .62);
        const opacity = mix(start.opacity ?? 1, end.opacity ?? 1, opacityProgress);
        scene.current.set(id, { ...template.current.get(id),
          y: mix(start.y, end.y, p), height: mix(start.height, end.height, p),
          labelY: mix(start.labelY, end.labelY, p), opacity });
      }
      for (const index of nodeIds) {
        const start = from.nodes.get(index) ?? { x: index < fromFirst ? from.xFor(fromFirst) : from.xFor(fromLast), opacity: 0 };
        const end = to.nodes.get(index) ?? { x: index > toLast ? to.xFor(toLast) : to.xFor(index), opacity: 0 };
        scene.nodes.set(index, { ...template.nodes.get(index), x: mix(start.x, end.x, p),
          opacity: mix(start.opacity ?? 1, end.opacity ?? 1, p) });
      }
      for (const [key, link] of template.merges) {
        const source = scene.paths.get(link.from)?.points.find(point => point.index === link.index - 1);
        const target = scene.paths.get(link.to)?.points.find(point => point.index === link.index);
        if (!source || !target) continue;
        const opacityProgress = from.merges.has(key) && to.merges.has(key) ? p
          : to.merges.has(key) ? clamp((p - .32) / .5) : p;
        const opacity = mix(from.merges.get(key)?.opacity ?? (from.merges.has(key) ? 1 : 0),
          to.merges.get(key)?.opacity ?? (to.merges.has(key) ? 1 : 0), opacityProgress);
        scene.merges.set(key, { ...link, x1: source.x, y1: source.y + source.height / 2,
          x2: target.x, y2: target.y + target.height / 2, opacity });
      }
      return scene;
    },
  };
}

export function createTimeMotion({ prepare, draw, complete, status, reduced }) {
  let visual = null, target = null, animation = null, last = null;
  function stop() { if (animation !== null) cancelAnimationFrame(animation); animation = null; }
  function settle() {
    stop();
    if (!target) return;
    visual = target; prepare(target); draw(target); complete?.(target); status?.('idle', 1);
  }
  function transition(next, options = {}) {
    stop();
    target = next;
    const duration = options.duration ?? 1600;
    if (!visual || reduced() || options.instant || duration === 0) {
      visual = target; prepare(target); draw(target); complete?.(target); status?.(reduced() ? 'reduced' : 'idle', 1);
      return;
    }
    const from = options.scrollLeft == null ? visual : { ...visual, scrollLeft: options.scrollLeft };
    const tween = makeTween(from, target, options);
    if (options.remember !== false) last = { from, target, options };
    prepare(tween.template);
    visual = tween.sample(0); draw(visual); status?.('running', 0);
    const started = performance.now();
    function tick(time) {
      const elapsed = clamp((time - started) / duration);
      const progress = elapsed === 1 ? 1 : easeProgress(elapsed);
      visual = tween.sample(progress); draw(visual); status?.('running', progress);
      if (elapsed < 1) animation = requestAnimationFrame(tick);
      else settle();
    }
    animation = requestAnimationFrame(tick);
  }
  return {
    transition, settle, stop,
    replay() { if (!last || reduced()) return; visual = last.from; transition(last.target, { ...last.options, remember: false }); },
    get running() { return animation !== null; },
    get canReplay() { return Boolean(last) && !reduced(); },
    get visual() { return visual; },
  };
}
