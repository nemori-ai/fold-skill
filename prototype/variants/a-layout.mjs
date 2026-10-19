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
//
// layoutFill() uses the same strip search edge to edge with the blank as the last entry; the original
// treemap uses it so that a one-share question never becomes a sliver.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const EPSILON = 0.5;
const TARGET = Math.log(1.25);
// How strongly a paper is pulled toward where it stood last round (see layoutPapers).
export const STABILITY = 6;

function paperCost(share, width, height) {
  // A strip that ran out of room: never the best layout, and never NaN (NaN would disable pruning).
  if (!(width > EPSILON && height > EPSILON)) return 1e9;
  const skew = Math.log(width / height) - TARGET;
  // Tall, narrow papers break Chinese lines sooner than wide ones.
  const shape = skew < 0 ? skew * 1.35 : skew;
  const extreme = Math.max(0, Math.abs(Math.log(width / height)) - Math.log(2.4));
  const thin = Math.max(0, 64 - Math.min(width, height)) / 24;
  return Math.sqrt(share) * shape * shape + 3 * extreme + thin * thin;
}

// Exhaustive order-preserving strip partition with pruning. Up to 12 papers both
// strip directions are tried; larger layers keep the conventional direction.
// `pull(entry, rect)` is an extra cost per paper (layoutPapers' stability term); layoutFill passes none.
function partition(entries, width, height, areaPerShare, pull = null) {
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
          rowCost += paperCost(entries[index].share, rect.width, rect.height) * (entries[index].costWeight ?? 1) + (pull ? pull(entries[index], rect) : 0);
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

/**
 * `previous` (optional): the layout this board showed last (a result of this function). Each paper that was on it is
 * pulled toward where it stood, in the cluster's own proportions, so a round that changes two shares does not reshuffle
 * the whole desk; `stability` weighs that pull against the paper shapes (0 turns it off).
 */
export function layoutPapers(items, budget, width, height, { previous = null, stability = STABILITY } = {}) {
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

  // Where each paper stood on the previous board, as a fraction of that cluster (its centre).
  const before = new Map();
  if (previous?.cluster && stability > 0) {
    const c = previous.cluster;
    for (const paper of previous.papers) before.set(paper.id, { x: (paper.cx - c.x) / c.width, y: (paper.cy - c.y) / c.height });
  }
  const pull = before.size ? (entry, rect) => {
    const was = before.get(entry.id);
    if (!was) return 0;
    const dx = (rect.x + rect.width / 2) / clusterWidth - was.x, dy = (rect.y + rect.height / 2) / clusterHeight - was.y;
    return stability * Math.sqrt(entry.share) * (dx * dx + dy * dy);
  } : null;
  const cells = partition(active, clusterWidth, clusterHeight, areaPerShare, pull);
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
  result.cluster = { x: left, y: top, width: spanWidth, height: spanHeight };
  const byId = new Map(active.map(item => [item.id, item]));
  for (const cell of cells) {
    const item = byId.get(cell.id);
    // Width and height come straight from the exact partition; only position shifts.
    result.papers.push({ id: cell.id, share: item.share, rank: item.rank,
      x: left + cell.x + cell.ax * gapX,
      y: top + cell.y + cell.ay * gapY,
      width: cell.width, height: cell.height,
      cx: left + cell.x + cell.ax * gapX + cell.width / 2, cy: top + cell.y + cell.ay * gapY + cell.height / 2 });
  }
  return result;
}

/** Edge-to-edge strips in rank order, blank last: every rectangle has exactly share / budget of the area. */
export function layoutFill(items, budget, width, height) {
  if (![budget, width, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Board layout needs a positive budget, width, and height.');
  }
  const entries = items.filter(item => item.status === undefined || item.status === 'active').map(item => ({ id: item.id, share: item.share }));
  if (entries.some(entry => !Number.isFinite(entry.share) || entry.share <= 0)) throw new Error('Invalid share.');
  const used = entries.reduce((sum, entry) => sum + entry.share, 0);
  if (used > budget) throw new Error('Board layout exceeds its budget.');
  // The blank carries no text, so its shape barely counts.
  if (used < budget) entries.push({ id: '__blank__', share: budget - used, isBlank: true, costWeight: 0.12 });
  const shares = new Map(entries.map(entry => [entry.id, entry]));
  return partition(entries, width, height, width * height / budget).map(cell => ({
    id: cell.id, share: shares.get(cell.id).share, isBlank: Boolean(shares.get(cell.id).isBlank),
    x: cell.x, y: cell.y, width: cell.width, height: cell.height,
  }));
}
