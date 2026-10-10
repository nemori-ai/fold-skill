// The paper areas encode shares exactly. Unoccupied space is never a card:
// it is the sum of the margins around the cluster and the gutters between papers.
//
// 1. Papers are packed in state-rank order (reading order: rank 1 starts at the
//    top-left of the cluster) as an exact slice partition. Every order-preserving
//    choice of strips is searched; the cost keeps each paper near a calm landscape
//    shape, weighted by share but never letting a small paper become a sliver.
// 2. The cluster occupies exactly used / budget of the board. Its proportions move
//    from a calm near-square toward the board's own proportions as the layer fills.
// 3. Gutters are inserted between neighbouring strips and papers. Every paper keeps its size;
//    only its position moves, so the blank area is exactly (budget - used) shares.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const EPSILON = 0.5;
const TARGET = Math.log(1.25);

function paperCost(share, width, height) {
  const skew = Math.log(width / height) - TARGET;
  // Tall, narrow papers break Chinese lines sooner than wide ones.
  const shape = skew < 0 ? skew * 1.35 : skew;
  const extreme = Math.max(0, Math.abs(Math.log(width / height)) - Math.log(2.4));
  const thin = Math.max(0, 64 - Math.min(width, height)) / 24;
  return Math.sqrt(share) * shape * shape + 3 * extreme + thin * thin;
}

// Exhaustive order-preserving strip partition with pruning. Up to 12 papers both
// strip directions are tried; larger layers keep the conventional direction.
function partition(entries, width, height, areaPerShare) {
  let best = null;
  const rects = [];
  // ax / ay count the gutters to the left of / above each paper. Gutters are local:
  // one between a strip and the rest, one between neighbours inside a strip.
  function search(start, x, y, w, h, cost, ax = 0, ay = 0) {
    if (best && cost >= best.cost) return;
    if (start === entries.length) { best = { cost, rects: rects.map(rect => ({ ...rect })) }; return; }
    let area = 0;
    for (let end = start + 1; end <= entries.length; end += 1) {
      area += entries[end - 1].share * areaPerShare;
      const last = end === entries.length;
      for (const vertical of last || entries.length > 12 ? [w >= h] : [true, false]) {
        const thickness = last ? (vertical ? w : h) : area / (vertical ? h : w);
        if (thickness > (vertical ? w : h) + EPSILON) continue;
        let offset = 0, rowCost = 0;
        const mark = rects.length;
        for (let index = start; index < end; index += 1) {
          const length = entries[index].share * areaPerShare / thickness;
          const step = index - start;
          const rect = vertical ? { id: entries[index].id, x, y: y + offset, width: thickness, height: length, ax, ay: ay + step }
            : { id: entries[index].id, x: x + offset, y, width: length, height: thickness, ax: ax + step, ay };
          rowCost += paperCost(entries[index].share, rect.width, rect.height);
          rects.push(rect); offset += length;
        }
        if (vertical) search(end, x + thickness, y, w - thickness, h, cost + rowCost, ax + 1, ay);
        else search(end, x, y + thickness, w, h - thickness, cost + rowCost, ax, ay + 1);
        rects.length = mark;
      }
    }
  }
  search(0, 0, 0, width, height, 0);
  return best.rects;
}

export function layoutPapers(items, budget, width, height) {
  if (![budget, width, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Paper layout needs a positive budget, width, and height.');
  }
  const active = items.filter(item => item.status === undefined || item.status === 'active')
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.rank ?? a.index + 1) - (b.item.rank ?? b.index + 1) || a.index - b.index)
    .map(({ item }) => item);
  if (active.some(item => !Number.isFinite(item.share) || item.share <= 0)) throw new Error('Invalid paper share.');
  const used = active.reduce((sum, item) => sum + item.share, 0);
  if (used > budget) throw new Error('Paper layout exceeds its budget.');
  const areaPerShare = width * height / budget;
  const result = { papers: [], used, areaPerShare, blankArea: (budget - used) * areaPerShare };
  if (!active.length) return result;

  const load = used / budget;
  const usedArea = used * areaPerShare;
  // Log-interpolate the cluster proportion: 1.35 when mostly empty, the board's
  // own proportion when full (a full board has to be filled edge to edge).
  const aspect = Math.exp(Math.log(1.35) * (1 - load) + Math.log(width / height) * load);
  let clusterWidth = Math.sqrt(usedArea * aspect);
  let clusterHeight = usedArea / clusterWidth;
  if (clusterWidth > width) { clusterWidth = width; clusterHeight = usedArea / width; }
  if (clusterHeight > height) { clusterHeight = height; clusterWidth = usedArea / height; }

  const cells = partition(active, clusterWidth, clusterHeight, areaPerShare);
  // Gutters use part of the slack on each axis; the rest stays as margin.
  const maxGap = clamp(Math.min(width, height) * 0.045, 6, 22);
  const gutter = (size, start, length, count) => cells.reduce((gap, cell) => cell[count] > 0
    ? Math.min(gap, (size - cell[start] - cell[length]) * 0.6 / cell[count]) : gap, maxGap);
  const gapX = Math.max(0, gutter(width, 'x', 'width', 'ax'));
  const gapY = Math.max(0, gutter(height, 'y', 'height', 'ay'));
  const spanWidth = Math.max(...cells.map(cell => cell.x + cell.width + cell.ax * gapX));
  const spanHeight = Math.max(...cells.map(cell => cell.y + cell.height + cell.ay * gapY));
  const left = (width - spanWidth) * 0.5;
  const top = (height - spanHeight) * 0.46;
  const byId = new Map(active.map(item => [item.id, item]));
  for (const cell of cells) {
    const item = byId.get(cell.id);
    // Width and height come straight from the exact partition; only position shifts.
    result.papers.push({ id: cell.id, share: item.share, rank: item.rank,
      x: left + cell.x + cell.ax * gapX,
      y: top + cell.y + cell.ay * gapY,
      width: cell.width, height: cell.height });
  }
  return result;
}
