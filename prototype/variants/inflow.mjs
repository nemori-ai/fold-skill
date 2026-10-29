// 本轮输入落到哪件：C 流动形态（每粒采用的输入落进哪一滴）与 E 折叠屏（左页摊开的原料，每组输入连向右页哪张卡）共用。
// 从 c.mjs 原样搬出（2026-10-29），规则不变：先看这一批声明引用了哪条输入（batch.declarations[].sources 的 event:），
// 再看输入自己的 relatedIds[0]；沿合并走到并入的那件，沿父级走到这一层。只产生数据，不碰 DOM。
import { scenario, records } from './shared.mjs?v=feedback-loop-1';

const frames = scenario.frames;
/** The dispositions an input can have; anything else is unjudged. */
export const DISP = new Set(['used', 'deferred', 'noise', 'duplicate']);

/** Which item of layer `layerId` (null = root) reference `id` belongs to at frame i: along merges, up through parents. */
export function inLayer(i, layerId, id) {
  const items = records[i].snapshot.items;
  let item = id && items[id];
  for (let guard = 0; item && guard < 24; guard += 1) {
    if (item.status === 'merged' && item.merged_into && items[item.merged_into]) { item = items[item.merged_into]; continue; }
    if ((item.parent_id || null) === (layerId || null)) return item.id;
    if (!item.parent_id || !items[item.parent_id]) return null;
    item = items[item.parent_id];
  }
  return null;
}

const cache = new Map();
/**
 * Where each input of frame i goes, in time order: { k (its index in frame.events), id, disp, at (ms), target (the item
 * of the layer it was taken into, for the adopted ones; null otherwise) }; targetOf[k] the same by index; counts by
 * disposition. Cached per frame and layer; the list is shared, callers must not change it.
 */
export function inputsOf(i, layerId = null) {
  const key = `${i}|${layerId || ''}`;
  if (cache.has(key)) return cache.get(key);
  const frame = frames[i];
  const cited = new Map();
  for (const d of frame.batch?.declarations || []) for (const s of d.sources || []) if (s.ref?.startsWith('event:')) cited.set(s.ref.slice(6), d.id);
  const list = frame.events.map((e, k) => {
    const disp = DISP.has(e.disposition) ? e.disposition : 'unjudged';
    return { k, id: e.id, disp, at: Date.parse(e.at), target: disp === 'used' ? inLayer(i, layerId, cited.get(e.id) || e.relatedIds?.[0]) : null };
  }).sort((a, b) => a.at - b.at);
  const targetOf = [];
  for (const g of list) targetOf[g.k] = g.target;
  const value = { list, targetOf, counts: list.reduce((n, g) => ({ ...n, [g.disp]: (n[g.disp] || 0) + 1 }), {}) };
  cache.set(key, value);
  return value;
}
/** itemFacts' `into` (dial-model.mjs) by this rule, at the root: which root item input k of a round went into. */
export const intoRoot = (round, k) => inputsOf(round, null).targetOf[k] ?? null;
