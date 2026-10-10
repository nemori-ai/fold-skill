// The paper areas encode shares exactly. Unoccupied space is never a card:
// it is the sum of the margins, irregular row offsets, and gaps between papers.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hash = value => [...String(value)].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const fraction = (id, salt) => (hash(`${salt}:${id}`) % 1000) / 1000;

export function layoutPapers(items, budget, width, height) {
  if (![budget, width, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Paper layout needs a positive budget, width, and height.');
  }
  const active = items.filter(item => item.status === undefined || item.status === 'active');
  if (active.some(item => !Number.isFinite(item.share) || item.share <= 0)) throw new Error('Invalid paper share.');
  const used = active.reduce((sum, item) => sum + item.share, 0);
  if (used > budget) throw new Error('Paper layout exceeds its budget.');
  const areaPerShare = width * height / budget;
  const result = { papers: [], used, areaPerShare, blankArea: (budget - used) * areaPerShare };
  if (!active.length) return result;
  // On a wide, shallow viewport, stacking every group into horizontal rows
  // creates banners that cannot carry a summary. Turn the same exact packing
  // into columns; this decision depends on the viewport, not changing ranks.
  if (active.length > 3 && width / height > 2) {
    const portrait = layoutPapers(active, budget, height, width);
    return { ...portrait, papers: portrait.papers.map(paper => ({ ...paper,
      x: paper.y, y: paper.x, width: paper.height, height: paper.width })) };
  }

  const load = used / budget;
  const open = 1 - load;
  if (active.length === 1) {
    const item = active[0], area = item.share * areaPerShare;
    const aspect = 1.12 + fraction(item.id, 'aspect') * 0.22;
    const paperWidth = clamp(Math.sqrt(area * aspect), area / height, width);
    const paperHeight = area / paperWidth;
    result.papers.push({ id: item.id, share: item.share,
      x: (width - paperWidth) * (0.47 + fraction(item.id, 'left') * 0.06),
      y: (height - paperHeight) * (0.44 + fraction(item.id, 'top') * 0.05),
      width: paperWidth, height: paperHeight });
    return result;
  }

  // Small layers stay together. Larger layers use stable identity-based rows,
  // so a change in rank, status, or text alone does not rearrange the whole desk.
  const groups = new Map();
  for (const item of active) {
    const key = active.length <= 3 ? 1 : hash(item.id) % 3;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const rows = [...groups].sort((a, b) => a[0] - b[0]).map(([key, row]) => ({ key,
    items: row.sort((a, b) => fraction(a.id, 'across') - fraction(b.id, 'across') || a.id.localeCompare(b.id)) }));
  const baseGap = Math.min(25, width * 0.045) * Math.sqrt(open);
  const compactWidth = active.reduce((sum, item) => sum + Math.sqrt(item.share * areaPerShare * (1.12 + fraction(item.id, 'aspect') * 0.22)), 0) + baseGap * (active.length - 1);
  const desiredWidth = clamp(active.length <= 3 ? compactWidth / width : Math.sqrt(load) + 0.10 * open, load, 1);
  const verticalGap = Math.min(30, height * 0.055) * Math.sqrt(open);
  function plan(relaxation) {
    const plans = rows.map(row => {
      const fullest = row.items.reduce((best, item) => item.share > best.share ? item : best, row.items[0]);
      const widthRatio = 1 - relaxation * (1 - desiredWidth + 0.075 * open * fraction(row.key, 'row-width'));
      const rowWidth = width * widthRatio;
      const gaps = row.items.slice(1).map(item => relaxation * baseGap * (0.65 + fraction(item.id, 'gap') * 0.70));
      const available = rowWidth - gaps.reduce((sum, gap) => sum + gap, 0);
      if (available <= 0) return null;
      const factors = row.items.map(item => item === fullest ? 1 : 1 - relaxation * 0.22 * open * fraction(item.id, 'height'));
      const rowHeight = row.items.reduce((sum, item, index) => sum + item.share * areaPerShare / factors[index], 0) / available;
      return { ...row, width: rowWidth, height: rowHeight, factors, gaps };
    });
    if (plans.some(row => row === null)) return { height: Infinity };
    const gaps = plans.slice(1).map(row => relaxation * verticalGap * (0.65 + fraction(row.key, 'vertical-gap') * 0.65));
    return { rows: plans, gaps, height: plans.reduce((sum, row) => sum + row.height, 0) + gaps.reduce((sum, gap) => sum + gap, 0) };
  }

  // At relaxation=0 this is an exact space-filling partition of the used
  // fraction. More breathing room is admitted only while the board can hold it.
  const ceiling = height * (1 - 0.12 * open);
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 36; iteration += 1) {
    const middle = (low + high) / 2;
    if (plan(middle).height <= ceiling) low = middle;
    else high = middle;
  }
  const geometry = plan(low);
  let y = (height - geometry.height) * 0.46;
  geometry.rows.forEach((row, rowIndex) => {
    let x = (width - row.width) * (0.40 + fraction(row.key, 'row-left') * 0.20);
    row.items.forEach((item, index) => {
      const paperHeight = row.height * row.factors[index];
      const paperWidth = item.share * areaPerShare / paperHeight;
      const top = y + (row.height - paperHeight) * fraction(item.id, 'baseline');
      result.papers.push({ id: item.id, share: item.share, x, y: top, width: paperWidth, height: paperHeight });
      x += paperWidth + (row.gaps[index] || 0);
    });
    y += row.height + (geometry.gaps[rowIndex] || 0);
  });
  return result;
}
