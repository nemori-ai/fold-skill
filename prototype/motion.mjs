// Visual-only transitions between two rendered boards. No state or layout writes.
// Usage: const before = motion.capture(); render(); motion.transition(before, options).
// Captures are reusable: their detached clones are never mounted or mutated.
// options: kind, anchorId, links:[{from,to}], duration, boards; contentChanged:false
// lets a no-op state frame clear temporary change labels without flashing tiles.

const VISUAL_STYLES = [
  'box-sizing', 'display', 'position', 'inset', 'top', 'right', 'bottom', 'left',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin', 'padding', 'gap', 'row-gap', 'column-gap', 'flex', 'flex-direction',
  'flex-wrap', 'flex-shrink', 'flex-grow', 'align-items', 'align-self',
  'justify-content', 'justify-self', 'order', 'grid-template-columns',
  'grid-template-rows', 'font-family', 'font-size', 'font-style', 'font-weight',
  'font-variant', 'font-feature-settings', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'text-decoration', 'text-overflow', 'white-space',
  'word-break', 'overflow-wrap', 'color', 'background', 'border', 'border-radius',
  'outline', 'outline-offset', 'box-shadow', 'opacity', 'overflow', 'overflow-x',
  'overflow-y', 'visibility', '-webkit-line-clamp', '-webkit-box-orient',
  'object-fit', 'vertical-align', 'z-index', 'appearance',
];
const TILE_SELECTOR = '.pin-tile[data-id], .pin-tile.is-blank';
const BLANK = '__blank__';
const clamp = value => Math.max(0, Math.min(1, value));
const mix = (a, b, t) => a + (b - a) * t;
// These offsets share the eased geometry progress. Keep the source readable
// through the departure, then hand its label to the destination near arrival.
const labelOpacity = (progress, incoming, zoom = false) => incoming
  ? clamp((progress - (zoom ? 0.48 : 0.40)) / (zoom ? 0.34 : 0.36))
  : 1 - clamp((progress - (zoom ? 0.34 : 0.28)) / (zoom ? 0.32 : 0.34));
const rectOf = element => {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
};
const usable = rect => rect && rect.width > 0.1 && rect.height > 0.1;
const sameRect = (a, b) => ['left', 'top', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < 0.1);
const center = rect => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const union = rects => {
  const left = Math.min(...rects.map(rect => rect.left));
  const top = Math.min(...rects.map(rect => rect.top));
  return { left, top, width: Math.max(...rects.map(rect => rect.left + rect.width)) - left,
    height: Math.max(...rects.map(rect => rect.top + rect.height)) - top };
};
const collapsed = (rect, point = center(rect), amount = 0.08) => ({
  left: point.x - rect.width * amount / 2, top: point.y - rect.height * amount / 2,
  width: Math.max(0.1, rect.width * amount), height: Math.max(0.1, rect.height * amount),
});
const project = (rect, from, to) => ({
  left: to.left + (rect.left - from.left) * to.width / from.width,
  top: to.top + (rect.top - from.top) * to.height / from.height,
  width: rect.width * to.width / from.width, height: rect.height * to.height / from.height,
});

function frozenClone(element) {
  const clone = element.cloneNode(true);
  const sources = [element, ...element.querySelectorAll('*')];
  const targets = [clone, ...clone.querySelectorAll('*')];
  sources.forEach((source, index) => {
    const target = targets[index];
    const style = getComputedStyle(source);
    for (const property of VISUAL_STYLES) target.style.setProperty(property, style.getPropertyValue(property));
    target.removeAttribute('id');
    target.removeAttribute('autofocus');
    for (const attribute of [...target.attributes]) if (attribute.name.startsWith('on')) target.removeAttribute(attribute.name);
    target.style.setProperty('transition', 'none', 'important');
    target.style.setProperty('animation', 'none', 'important');
    target.style.setProperty('pointer-events', 'none', 'important');
  });
  clone.inert = true;
  clone.setAttribute('aria-hidden', 'true');
  Object.assign(clone.style, { position: 'absolute', inset: '0', margin: '0',
    width: '100%', height: '100%', minWidth: '0', minHeight: '0', maxWidth: 'none',
    maxHeight: 'none', transform: 'none', opacity: '1', visibility: 'visible' });
  return clone;
}

function slots(rect, sources) {
  const total = sources.reduce((sum, source) => sum + source.rect.width * source.rect.height, 0);
  let offset = 0;
  return sources.map((source, index) => {
    const fraction = source.rect.width * source.rect.height / total;
    const remainder = index === sources.length - 1 ? 1 - offset : fraction;
    const slot = rect.width >= rect.height
      ? { left: rect.left + rect.width * offset, top: rect.top, width: rect.width * remainder, height: rect.height }
      : { left: rect.left, top: rect.top + rect.height * offset, width: rect.width, height: rect.height * remainder };
    offset += fraction;
    return slot;
  });
}

// Zero slope at both ends gives the eye time to locate the source and settle
// on the destination. Unlike an initial ease-out burst, distance unfolds first.
export function createBoardMotion({ duration = 1400, easing = 'cubic-bezier(.42,0,.28,1)' } = {}) {
  const keys = new WeakMap();
  let nextKey = 0, sequence = 0, active = null;
  let last = { status: 'idle', type: null, kinds: {}, boardCount: 0, plannedCount: 0, lastReason: null };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const boardKey = element => {
    if (element.id) return element.id;
    if (!keys.has(element)) keys.set(element, `board-${++nextKey}`);
    return keys.get(element);
  };
  function elements(input) {
    if (!input) return [...document.querySelectorAll('.pinboard')];
    if (typeof input === 'string') return [...document.querySelectorAll(input)];
    if (input.nodeType === 1) return [input];
    return [...input];
  }
  function readBoards(input, sampleMotion = false) {
    return elements(input).filter(element => element?.isConnected).map(element => {
      const rect = rectOf(element);
      if (!usable(rect) || getComputedStyle(element).visibility === 'hidden') return null;
      const key = boardKey(element);
      const tiles = new Map();
      for (const tile of element.querySelectorAll(TILE_SELECTOR)) {
        const tileRect = rectOf(tile);
        if (!usable(tileRect)) continue;
        const id = tile.dataset.id ?? BLANK;
        const flying = sampleMotion ? active?.faces.filter(face => face.boardKey === key && face.id === id)
          .sort((a, b) => Number(getComputedStyle(b.host).opacity) - Number(getComputedStyle(a.host).opacity))[0] : null;
        if (flying && Number(getComputedStyle(flying.host).opacity) > 0.02) {
          tiles.set(id, { ...flying.snapshot, rect: rectOf(flying.host), clone: flying.snapshot.clone.cloneNode(true) });
        } else {
          tiles.set(id, { id, rect: tileRect, natural: { width: tileRect.width, height: tileRect.height }, clone: frozenClone(tile) });
        }
      }
      // An outgoing face may still be visible during a rapid seek. Keep that
      // geometry available even though its logical item has left the new DOM.
      if (sampleMotion && active) for (const face of active.faces) {
        if (face.boardKey === key && !tiles.has(face.id) && Number(getComputedStyle(face.host).opacity) > 0.08) {
          tiles.set(face.id, { ...face.snapshot, rect: rectOf(face.host), clone: face.snapshot.clone.cloneNode(true) });
        }
      }
      return { key, element, rect, tiles };
    }).filter(Boolean);
  }
  function finish(flight, status, reason = null) {
    if (active !== flight) return;
    active = null;
    clearTimeout(flight.timeout);
    for (const animation of flight.animations) animation.cancel();
    for (const [element, styles] of flight.hidden) {
      if (!element.isConnected) continue;
      for (const [name, value, priority] of styles) {
        if (value) element.style.setProperty(name, value, priority);
        else element.style.removeProperty(name);
      }
    }
    flight.root.remove();
    for (const remove of flight.listeners) remove();
    last = { ...last, status, lastReason: reason };
    flight.resolve({ status, reason, type: flight.type, count: flight.faces.length });
  }
  function cancel(reason = 'cancelled') {
    if (active) finish(active, 'cancelled', reason);
  }
  function capture(boards) {
    const snapshot = { boards: readBoards(boards, true), sequence: ++sequence };
    cancel('recaptured');
    return snapshot;
  }
  function transition(before, options = {}) {
    cancel('superseded');
    const kind = options.kind ?? 'frame';
    const time = Math.max(0, Number(options.duration ?? duration) || 0);
    if (!before?.boards || reduced.matches || time === 0 || typeof Element.prototype.animate !== 'function') {
      last = { status: reduced.matches ? 'reduced' : 'skipped', type: kind, kinds: {}, boardCount: 0, plannedCount: 0, lastReason: null };
      return Promise.resolve({ status: last.status, type: kind, count: 0 });
    }
    const after = readBoards(options.boards);
    const oldBoards = new Map(before.boards.map(board => [board.key, board]));
    const newBoards = new Map(after.map(board => [board.key, board]));
    const root = document.createElement('div');
    root.dataset.foldMotionOverlay = '';
    root.inert = true;
    root.setAttribute('aria-hidden', 'true');
    Object.assign(root.style, { position: 'fixed', inset: '0', overflow: 'hidden',
      pointerEvents: 'none', zIndex: '1000', isolation: 'isolate' });
    document.body.append(root);
    let resolve;
    const completion = new Promise(done => { resolve = done; });
    const flight = { root, resolve, type: kind, animations: [], faces: [], hidden: [], listeners: [], boards: after, timeout: null };
    active = flight;
    const kinds = {};
    const countKind = name => { kinds[name] = (kinds[name] ?? 0) + 1; };
    function remember(element, properties) {
      flight.hidden.push([element, properties.map(name => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)])]);
    }
    function animate(element, frames) {
      const animation = element.animate(frames, { duration: time, easing, fill: 'both' });
      flight.animations.push(animation);
      return animation;
    }
    function face(board, layer, snapshot, from, to, incoming, mode = kind) {
      const host = document.createElement('div');
      host.dataset.motionId = snapshot.id;
      host.dataset.motionFace = incoming ? 'new' : 'old';
      const natural = snapshot.natural;
      Object.assign(host.style, { position: 'absolute', left: '0', top: '0',
        width: `${natural.width}px`, height: `${natural.height}px`, transformOrigin: '0 0',
        overflow: 'hidden', pointerEvents: 'none', willChange: 'transform, opacity' });
      const shape = snapshot.clone.cloneNode(false);
      const content = snapshot.clone.cloneNode(true);
      Object.assign(content.style, { background: 'transparent', boxShadow: 'none', outline: 'none',
        borderColor: 'transparent', transformOrigin: '0 0', willChange: 'transform, opacity' });
      host.append(shape, content);
      layer.element.append(host);
      const transform = rect => `translate(${rect.left - layer.rect.left}px,${rect.top - layer.rect.top}px) scale(${rect.width / natural.width},${rect.height / natural.height})`;
      const zoom = mode === 'dive' || mode === 'rise';
      animate(host, [{ transform: transform(from) }, { transform: transform(to) }]);
      // Delay the incoming surface too: otherwise it covers the retained old
      // label before the text itself has reached its hand-off point.
      animate(host, incoming ? [
        { offset: 0, opacity: 0 }, { offset: zoom ? 0.28 : 0.20, opacity: 0 },
        { offset: 0.82, opacity: 1 }, { offset: 1, opacity: 1 },
      ] : [
        { offset: 0, opacity: 1 }, { offset: 0.58, opacity: 1 }, { offset: 1, opacity: 0 },
      ]);
      // Counter-scale the content so Chinese glyphs keep their proportions.
      // Content changes crossfade around the middle while the solid area moves.
      const samples = zoom ? 40 : 24;
      const contentFrames = Array.from({ length: samples + 1 }, (_, index) => {
        const progress = index / samples;
        const sx = mix(from.width, to.width, progress) / natural.width;
        const sy = mix(from.height, to.height, progress) / natural.height;
        return { offset: progress, transform: `scale(${1 / sx},${1 / sy})`,
          opacity: labelOpacity(progress, incoming, zoom) };
      });
      animate(content, contentFrames);
      flight.faces.push({ boardKey: board.key, id: snapshot.id, host, snapshot });
    }
    function moveFace(board, layer, previous, next) {
      // A stable item gets one opaque carrier. Only its text changes faces;
      // fading two entire tiles would expose the board through their overlap.
      const host = document.createElement('div');
      host.dataset.motionId = next.id;
      host.dataset.motionFace = 'move';
      const natural = next.natural, from = previous.rect, to = next.rect;
      Object.assign(host.style, { position: 'absolute', left: '0', top: '0',
        width: `${natural.width}px`, height: `${natural.height}px`, transformOrigin: '0 0',
        overflow: 'hidden', pointerEvents: 'none', willChange: 'transform', opacity: '1' });
      const shape = next.clone.cloneNode(false);
      host.append(shape);
      layer.element.append(host);
      const transform = rect => `translate(${rect.left - layer.rect.left}px,${rect.top - layer.rect.top}px) scale(${rect.width / natural.width},${rect.height / natural.height})`;
      animate(host, [{ transform: transform(from) }, { transform: transform(to) }]);
      const shapeKeys = ['backgroundColor', 'boxShadow', 'outlineColor', 'borderColor'];
      if (shapeKeys.some(key => previous.clone.style[key] !== next.clone.style[key])) {
        animate(shape, [Object.fromEntries(shapeKeys.map(key => [key, previous.clone.style[key]])),
          Object.fromEntries(shapeKeys.map(key => [key, next.clone.style[key]]))]);
      }
      for (const [snapshot, incoming] of [[previous, false], [next, true]]) {
        const content = snapshot.clone.cloneNode(true);
        Object.assign(content.style, { width: `${snapshot.natural.width}px`, height: `${snapshot.natural.height}px`,
          background: 'transparent', boxShadow: 'none', outline: 'none', borderColor: 'transparent',
          transformOrigin: '0 0', willChange: 'transform, opacity' });
        host.append(content);
        animate(content, Array.from({ length: 25 }, (_, index) => {
          const progress = index / 24;
          return { offset: progress,
            transform: `scale(${natural.width / mix(from.width, to.width, progress)},${natural.height / mix(from.height, to.height, progress)})`,
            opacity: labelOpacity(progress, incoming) };
        }));
      }
      flight.faces.push({ boardKey: board.key, id: next.id, host, snapshot: next });
    }
    try {
      for (const key of new Set([...oldBoards.keys(), ...newBoards.keys()])) {
        const oldBoard = oldBoards.get(key), newBoard = newBoards.get(key);
        const board = newBoard ?? oldBoard;
        const oldTiles = oldBoard?.tiles ?? new Map(), newTiles = newBoard?.tiles ?? new Map();
        const oldAnchor = oldTiles.get(options.anchorId), newAnchor = newTiles.get(options.anchorId);
        const zooming = (kind === 'dive' && oldAnchor && newBoard) || (kind === 'rise' && newAnchor && oldBoard);
        const unchanged = new Set();
        if (!zooming) for (const [id, tile] of oldTiles) {
          const next = newTiles.get(id);
          if (next && sameRect(tile.rect, next.rect)
            && (options.contentChanged === false || tile.clone.isEqualNode(next.clone))) unchanged.add(id);
        }
        if (unchanged.size === oldTiles.size && unchanged.size === newTiles.size) continue;
        const clip = union([oldBoard?.rect, newBoard?.rect].filter(Boolean));
        const layer = document.createElement('div');
        layer.dataset.motionBoard = key;
        Object.assign(layer.style, { position: 'absolute', left: `${clip.left}px`, top: `${clip.top}px`,
          width: `${clip.width}px`, height: `${clip.height}px`, overflow: 'hidden', pointerEvents: 'none' });
        root.append(layer);
        const plane = { element: layer, rect: clip };
        if (newBoard) {
          remember(newBoard.element, ['pointer-events']);
          newBoard.element.style.setProperty('pointer-events', 'none', 'important');
          for (const tile of newBoard.element.querySelectorAll(TILE_SELECTOR)) {
            if (unchanged.has(tile.dataset.id ?? BLANK)) continue;
            remember(tile, ['opacity']);
            tile.style.setProperty('opacity', '0', 'important');
          }
        }
        if (kind === 'dive' && oldAnchor && newBoard) {
          countKind('dive');
          for (const tile of oldTiles.values()) face(board, plane, tile, tile.rect,
            project(tile.rect, oldAnchor.rect, newBoard.rect), false, 'dive');
          for (const tile of newTiles.values()) face(board, plane, tile,
            project(tile.rect, newBoard.rect, oldAnchor.rect), tile.rect, true, 'dive');
          continue;
        }
        if (kind === 'rise' && newAnchor && oldBoard) {
          countKind('rise');
          for (const tile of oldTiles.values()) face(board, plane, tile, tile.rect,
            project(tile.rect, oldBoard.rect, newAnchor.rect), false, 'rise');
          for (const tile of newTiles.values()) face(board, plane, tile,
            project(tile.rect, newAnchor.rect, oldBoard.rect), tile.rect, true, 'rise');
          continue;
        }
        const handledOld = new Set(), handledNew = new Set();
        for (const [id, tile] of oldTiles) if (newTiles.has(id)) {
          const next = newTiles.get(id);
          if (!unchanged.has(id)) { moveFace(board, plane, tile, next); countKind('move'); }
          handledOld.add(id); handledNew.add(id);
        }
        const links = (options.links ?? []).map(link => {
          if (oldTiles.has(link.from) && newTiles.has(link.to)) return link;
          if (oldTiles.has(link.to) && newTiles.has(link.from)) return { from: link.to, to: link.from };
          return null;
        }).filter(link => link && !handledOld.has(link.from) && !handledNew.has(link.to));
        const targets = new Map(), sources = new Map();
        for (const { from, to } of links) {
          if (!targets.has(to)) targets.set(to, new Set());
          if (!sources.has(from)) sources.set(from, new Set());
          targets.get(to).add(from); sources.get(from).add(to);
        }
        for (const [to, fromIds] of targets) {
          if (fromIds.size < 2) continue;
          const next = newTiles.get(to), old = [...fromIds].map(id => oldTiles.get(id));
          const destinations = slots(next.rect, old);
          old.forEach((tile, index) => { face(board, plane, tile, tile.rect, destinations[index], false); handledOld.add(tile.id); });
          face(board, plane, next, union(old.map(tile => tile.rect)), next.rect, true);
          handledNew.add(to); countKind('merge');
        }
        for (const [from, toIds] of sources) {
          if (toIds.size < 2 || handledOld.has(from)) continue;
          const old = oldTiles.get(from), next = [...toIds].map(id => newTiles.get(id));
          const origins = slots(old.rect, next);
          face(board, plane, old, old.rect, union(next.map(tile => tile.rect)), false);
          next.forEach((tile, index) => { face(board, plane, tile, origins[index], tile.rect, true); handledNew.add(tile.id); });
          handledOld.add(from); countKind('split');
        }
        for (const [id, tile] of oldTiles) if (!handledOld.has(id)) {
          const point = newTiles.has(BLANK) ? center(newTiles.get(BLANK).rect) : center(newBoard?.rect ?? oldBoard.rect);
          face(board, plane, tile, tile.rect, collapsed(tile.rect, point), false);
          countKind('exit');
        }
        for (const [id, tile] of newTiles) if (!handledNew.has(id)) {
          face(board, plane, tile, collapsed(tile.rect, center(tile.rect), 0.15), tile.rect, true);
          countKind('enter');
        }
      }
      last = { status: 'running', type: kind, kinds, boardCount: root.childElementCount,
        plannedCount: flight.animations.length, lastReason: null };
      if (flight.animations.length === 0) {
        finish(flight, 'finished');
        return completion;
      }
      const onResize = () => cancel('resize');
      const onScroll = event => {
        if (event.target === document || event.target === window || flight.boards.some(board => event.target.contains?.(board.element))) cancel('scroll');
      };
      const onReduced = () => { if (reduced.matches) cancel('reduced-motion'); };
      window.addEventListener('resize', onResize, { passive: true });
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
      reduced.addEventListener?.('change', onReduced);
      flight.listeners.push(() => window.removeEventListener('resize', onResize),
        () => window.removeEventListener('scroll', onScroll, true),
        () => reduced.removeEventListener?.('change', onReduced));
      Promise.allSettled(flight.animations.map(animation => animation.finished))
        .then(() => finish(flight, 'finished'));
      flight.timeout = setTimeout(() => finish(flight, 'finished', 'timeout'), time + 250);
      return completion;
    } catch (error) {
      finish(flight, 'cancelled', 'error');
      throw error;
    }
  }
  function inspect() {
    return { ...last, kinds: { ...last.kinds }, running: Boolean(active),
      count: active?.animations.length ?? 0, faceCount: active?.faces.length ?? 0,
      overlayCount: active?.root.isConnected ? 1 : 0, reducedMotion: reduced.matches };
  }
  return { capture, transition, cancel, inspect };
}
