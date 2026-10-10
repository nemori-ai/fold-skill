// View geometry only. No state edits, interpolation of business values, or packing.
// Each marked cross-section is exactly one accepted state, with its own budget.

export function stableOrder(layers) {
  const seen = new Set();
  const order = [];
  for (const layer of layers) for (const item of layer.items ?? []) {
    if (!seen.has(item.id)) { seen.add(item.id); order.push(item.id); }
  }
  return order;
}

export function layoutSection(layer, order, height) {
  const budget = layer.budget;
  if (!(budget > 0) || !(height > 0)) throw new RangeError('A section needs a positive budget and height');
  const items = new Map((layer.items ?? []).map(item => [item.id, item]));
  const ids = [...order, ...[...items.keys()].filter(id => !order.includes(id))];
  const used = [...items.values()].reduce((sum, item) => sum + item.share, 0);
  if (used > budget || [...items.values()].some(item => !(item.share > 0))) throw new RangeError('Invalid layer allocation');
  const unit = height / budget;
  const gap = (budget - used) * unit / (items.size + 1);
  const placed = new Map();
  let cursor = gap;
  for (const id of ids) {
    const item = items.get(id);
    if (!item) continue;
    placed.set(id, { id, item, y: cursor, height: item.share * unit });
    cursor += item.share * unit + gap;
  }
  // Missing items have zero area. Their join sits between the nearest surviving
  // neighbours, so an appearance never swaps the order of unrelated items.
  const points = new Map();
  ids.forEach((id, index) => {
    if (placed.has(id)) { points.set(id, placed.get(id)); return; }
    const above = ids.slice(0, index).reverse().map(key => placed.get(key)).find(Boolean);
    const below = ids.slice(index + 1).map(key => placed.get(key)).find(Boolean);
    const top = above ? above.y + above.height : 0;
    const bottom = below ? below.y : height;
    points.set(id, { id, item: null, y: (top + bottom) / 2, height: 0 });
  });
  return { budget, used, blank: budget - used, unit, gap, height, items: [...placed.values()], points };
}

const number = value => Number(value.toFixed(3));
function edge(points, bottom = false) {
  if (!points.length) return '';
  const y = point => point.y + (bottom ? point.height : 0);
  let path = `M ${number(points[0].x)} ${number(y(points[0]))}`;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1], after = points[index];
    const middle = (before.x + after.x) / 2;
    path += ` C ${number(middle)} ${number(y(before))} ${number(middle)} ${number(y(after))} ${number(after.x)} ${number(y(after))}`;
  }
  return path;
}

export function bandPath(points) {
  if (!points.some(point => point.height > 0) || points.length < 2) return '';
  const reverse = [...points].reverse();
  return `${edge(points)} L ${number(reverse[0].x)} ${number(reverse[0].y + reverse[0].height)} ${edge(reverse, true).replace(/^M [^C]+(?= C|$)/, '')} Z`;
}

export function labelPositions(items, height, { heights, gap: requestedGap = 4 } = {}) {
  if (!items.length) return new Map();
  if (heights) {
    const sizes = items.map(item => heights.get(item.id) ?? 38);
    const total = sizes.reduce((sum, size) => sum + size, 0);
    const gap = Math.max(0, Math.min(requestedGap, (height - total - 4) / Math.max(1, items.length - 1)));
    const ys = items.map((item, index) => Math.max(item.y + item.height / 2, sizes[index] / 2 + 2));
    for (let index = 1; index < ys.length; index += 1) {
      ys[index] = Math.max(ys[index], ys[index - 1] + (sizes[index - 1] + sizes[index]) / 2 + gap);
    }
    ys[ys.length - 1] = Math.min(ys.at(-1), height - sizes.at(-1) / 2 - 2);
    for (let index = ys.length - 2; index >= 0; index -= 1) {
      ys[index] = Math.min(ys[index], ys[index + 1] - (sizes[index] + sizes[index + 1]) / 2 - gap);
    }
    return new Map(items.map((item, index) => [item.id, ys[index]]));
  }
  const margin = 19;
  const distance = Math.min(44, (height - margin * 2) / Math.max(1, items.length - 1));
  const ys = items.map((item, index) => Math.max(item.y + item.height / 2,
    index ? 0 : margin));
  for (let i = 1; i < ys.length; i += 1) ys[i] = Math.max(ys[i], ys[i - 1] + distance);
  if (ys.at(-1) > height - margin) ys[ys.length - 1] = height - margin;
  for (let i = ys.length - 2; i >= 0; i -= 1) ys[i] = Math.min(ys[i], ys[i + 1] - distance);
  return new Map(items.map((item, index) => [item.id, ys[index]]));
}

// The middle line of one band across several nodes, for marks that stay on that item.
export function centerPath(points) {
  return edge(points.map(point => ({ ...point, y: point.y + point.height / 2, height: 0 })));
}
