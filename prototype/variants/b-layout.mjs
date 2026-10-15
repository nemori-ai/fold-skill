// B · 时间展开：只有视图几何。不改状态、不插值业务数值、不打包。
// 每个截面恰好是一个被接受的状态，各自 64 份；份额不足 SMALL 的事项（至少两件时）
// 合成一条“小事”带，排在其余事项之后，未分配的份额排在最底下。
export const SMALL = 3;
export const GROUP = '__small__';

export function stableOrder(layers) {
  const seen = new Set();
  const order = [];
  for (const layer of layers) for (const item of layer.items ?? []) {
    if (!seen.has(item.id)) { seen.add(item.id); order.push(item.id); }
  }
  return order;
}

/**
 * One accepted state as a vertical cross-section of `height` px.
 * Returns placed points { id, item, y, h, grouped }, the group span (or null), the blank span, and
 * anchor(id, zone): where a missing item would sit, so appearances never reorder unrelated items.
 */
export function layoutSection(layer, order, height, { small = SMALL } = {}) {
  const budget = layer.budget ?? 64;
  if (!(budget > 0) || !(height > 0)) throw new RangeError('A section needs a positive budget and height');
  const items = new Map((layer.items ?? []).map(item => [item.id, item]));
  const ids = [...order, ...[...items.keys()].filter(id => !order.includes(id))];
  const used = [...items.values()].reduce((sum, item) => sum + item.share, 0);
  if (used > budget || [...items.values()].some(item => !(item.share > 0))) throw new RangeError('Invalid layer allocation');
  const unit = height / budget;
  const little = ids.filter(id => items.has(id) && items.get(id).share < small);
  const grouping = little.length >= 2;
  const separate = ids.filter(id => items.has(id) && !(grouping && items.get(id).share < small));
  const placed = new Map();
  let cursor = 0;
  for (const id of separate) {
    const item = items.get(id);
    placed.set(id, { id, item, y: cursor, h: item.share * unit, grouped: false });
    cursor += item.share * unit;
  }
  let group = null;
  if (grouping) {
    const top = cursor;
    for (const id of little) {
      const item = items.get(id);
      placed.set(id, { id, item, y: cursor, h: item.share * unit, grouped: true });
      cursor += item.share * unit;
    }
    group = { y: top, h: cursor - top, members: little, share: little.reduce((sum, id) => sum + items.get(id).share, 0) };
  }
  const blank = { y: cursor, h: Math.max(0, height - cursor), share: budget - used };
  function anchor(id, zone) {
    const index = ids.indexOf(id);
    const pool = zone === 'group' ? (group ? little : []) : separate;
    const before = ids.slice(0, Math.max(0, index)).reverse().find(other => pool.includes(other));
    if (before) { const point = placed.get(before); return point.y + point.h; }
    if (zone === 'group') return group ? group.y : cursor;
    return 0;
  }
  return { budget, used, unit, height, placed, separate, group, blank, anchor };
}

const n = value => Number(value.toFixed(2));
function edge(points, bottom = false) {
  if (!points.length) return '';
  const y = point => point.y + (bottom ? point.h : 0);
  let path = `M ${n(points[0].x)} ${n(y(points[0]))}`;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1], after = points[index];
    const middle = (before.x + after.x) / 2;
    path += ` C ${n(middle)} ${n(y(before))} ${n(middle)} ${n(y(after))} ${n(after.x)} ${n(y(after))}`;
  }
  return path;
}
/** A smooth ribbon through { x, y, h } points; '' when it has no thickness anywhere. */
export function bandPath(points) {
  if (points.length < 2 || !points.some(point => point.h > .05)) return '';
  const reverse = [...points].reverse();
  return `${edge(points)} L ${n(reverse[0].x)} ${n(reverse[0].y + reverse[0].h)} ${edge(reverse, true).replace(/^M [^C]+(?= C|$)/, '')} Z`;
}
/** The middle line of one band across several nodes, for marks that stay on that item. */
export function centerPath(points) {
  return edge(points.map(point => ({ ...point, y: point.y + point.h / 2, h: 0 })));
}

/** Label centres near their bands, pushed apart to fit measured heights; stays inside [0, height]. */
export function labelPositions(entries, height, { heights, gap = 4 } = {}) {
  if (!entries.length) return new Map();
  const sizes = entries.map(entry => heights?.get(entry.id) ?? 38);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const space = Math.max(0, Math.min(gap, (height - total - 4) / Math.max(1, entries.length - 1)));
  const ys = entries.map((entry, index) => Math.max(entry.y + entry.h / 2, sizes[index] / 2 + 2));
  for (let index = 1; index < ys.length; index += 1) ys[index] = Math.max(ys[index], ys[index - 1] + (sizes[index - 1] + sizes[index]) / 2 + space);
  ys[ys.length - 1] = Math.min(ys.at(-1), height - sizes.at(-1) / 2 - 2);
  for (let index = ys.length - 2; index >= 0; index -= 1) ys[index] = Math.min(ys[index], ys[index + 1] - (sizes[index] + sizes[index + 1]) / 2 - space);
  return new Map(entries.map((entry, index) => [entry.id, ys[index]]));
}

// ---------- 此刻之后 ----------
const HOUR = 3600000;
// Piecewise scale: the next day gets most of the room, weeks are compressed, past five weeks clamps.
const STEPS = [[0, 0], [12 * HOUR, .22], [24 * HOUR, .38], [72 * HOUR, .58], [7 * 24 * HOUR, .78], [35 * 24 * HOUR, .96]];
export const FUTURE_GRID = [[12 * HOUR, '12 小时'], [24 * HOUR, '1 天'], [72 * HOUR, '3 天'], [7 * 24 * HOUR, '1 周'], [35 * 24 * HOUR, '5 周']];
/** Fraction 0..1 of the future strip for a time span after now; negative spans (overdue) clamp to 0. */
export function futureFraction(span) {
  if (!(span > 0)) return 0;
  for (let index = 1; index < STEPS.length; index += 1) {
    const [t1, f1] = STEPS[index], [t0, f0] = STEPS[index - 1];
    if (span <= t1) return f0 + (f1 - f0) * (span - t0) / (t1 - t0);
  }
  const [last, f] = STEPS.at(-1);
  return Math.min(1, f + .04 * Math.log2(1 + (span - last) / last));
}

/**
 * Stack tick captions so two deadlines never print over each other. A caption spans from its tick to
 * the right by its measured width (`meta.width`, else `width`); a clash moves it one line down, or up
 * when that would leave the strip (`height`), e.g. two small items with deadlines in the 小事 band.
 */
export function placeCaptions(ticks, { lineHeight = 26, width = 120, height = Infinity } = {}) {
  const placed = [];
  const span = tick => [tick.x - 8, tick.x + 8 + (tick.meta?.width ?? width)];
  const clash = (tick, y) => placed.find(other => {
    const [a0, a1] = span(tick), [b0, b1] = span(other);
    return a0 < b1 && b0 < a1 && Math.abs(other.ty - y) < lineHeight;
  });
  for (const tick of [...ticks].sort((a, b) => a.y - b.y)) {
    let y = tick.y;
    for (let guard = 0, other; guard < 12 && (other = clash(tick, y)); guard += 1) {
      y = other.ty + lineHeight + lineHeight / 2 <= height ? other.ty + lineHeight : other.ty - lineHeight;
    }
    tick.ty = y; placed.push(tick);
  }
  return ticks;
}
