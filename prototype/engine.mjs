// In-memory prototype only: no files, clocks, network, or product CLI.
// Snapshots retain every item. projectState supplies the active tree plus an
// explicitly separate historical inspection helper; presentation stays outside it.

const WEIGHTS = { critical: 24, high: 12, normal: 6, low: 3, trace: 1 };
const KINDS = new Set(['needs-you', 'in-progress', 'done', 'fyi']);
const BUDGET = 64;
const BUSINESS_FIELDS = [
  'title', 'summary', 'weight', 'share_override', 'share', 'kind', 'due_at',
  'stale_after', 'sources', 'parent_id', 'status', 'merged_into', 'children',
];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const lookup = (value, key) => own(value, key) ? value[key] : undefined;
const put = (map, key, value) => Object.defineProperty(map, key,
  { value, enumerable: true, writable: true, configurable: true });
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  }
  return value;
}
const equal = (a, b) => canonical(a) === canonical(b);

export class FoldError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'FoldError';
    this.code = code;
    this.details = details;
  }
}
const fail = (code, message, details) => { throw new FoldError(code, message, details); };
function timestamp(value, field = 'now') {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail('invalid_time', `${field} must be an explicit ISO timestamp`, { field, value });
  }
  return Date.parse(value);
}
function requireText(value, field, max = Infinity) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max) {
    fail('invalid_field', `${field} must be nonempty and at most ${max} characters`, { field, value });
  }
}
function initialSnapshot() {
  return { budget: BUDGET, revision: 'r0', event_seq: 0, items: {}, annotations: {},
    last_checked_at: null, last_checked_by_actor: {}, events: [], receipts: {} };
}
const nextRevision = revision => `r${Number(revision.slice(1)) + 1}`;
function childrenOf(snapshot, parent, activeOnly = true) {
  return Object.values(snapshot.items)
    .filter(item => item.parent_id === parent && (!activeOnly || item.status === 'active'));
}
function descendants(snapshot, id, activeOnly = false) {
  const result = [];
  const visit = parent => {
    for (const child of childrenOf(snapshot, parent, false)) {
      if (!activeOnly || child.status === 'active') result.push(child.id);
      visit(child.id);
    }
  };
  visit(id);
  return result;
}
function businessItem(snapshot, item) {
  return Object.fromEntries(BUSINESS_FIELDS.map(field => [field,
    field === 'children' ? childrenOf(snapshot, item.id).map(child => child.id).sort() : item[field] ?? null,
  ]));
}
function parseRelation(declaration) {
  const relation = declaration.relation ?? (own(declaration, 'relation') ? null : 'new');
  if (relation === 'new' || relation === 'withdraw') return { type: relation };
  if (typeof relation !== 'string') fail('unsupported_relation', 'relation must be a supported string');
  if (relation.startsWith('supersedes:')) return { type: 'supersedes', target: relation.slice(11) };
  const match = relation.match(/^merges:\s*\[(.*)\]$/);
  if (match) {
    const ids = match[1].split(',').map(id => id.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    if (ids.length < 2 || new Set(ids).size !== ids.length) {
      fail('invalid_merge', 'merge needs at least two distinct source IDs', { ids });
    }
    return { type: 'merges', ids };
  }
  fail('unsupported_relation', `Unsupported relation ${relation}`);
}
function knownItem(snapshot, id) {
  const item = lookup(snapshot.items, id);
  if (!item) fail('item_not_found', `Unknown item ${id}`, { item: id });
  return item;
}
function writableItem(snapshot, id) {
  const item = knownItem(snapshot, id);
  if (item.status === 'merged') {
    fail('item_merged', `${id} has a successor`, { item: id, merged_into: item.merged_into });
  }
  return item;
}
function normalizeSources(sources) {
  if (sources === null) return [];
  if (!Array.isArray(sources)) fail('invalid_field', 'sources must be an array or null', { field: 'sources' });
  for (const source of sources) {
    if (!source || typeof source !== 'object') fail('invalid_field', 'source must be an object');
    requireText(source.channel, 'sources.channel');
    requireText(source.ref, 'sources.ref');
    if (own(source, 'observed_at') && source.observed_at !== null) timestamp(source.observed_at, 'observed_at');
  }
  return copy(sources);
}
function dedupe(values) {
  const seen = new Set();
  return values.filter(value => {
    const key = canonical(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function applyFields(item, declaration, now) {
  for (const field of ['title', 'summary', 'weight', 'kind', 'reason', 'due_at', 'stale_after']) {
    if (own(declaration, field)) item[field] = copy(declaration[field]);
  }
  if (own(declaration, 'sources')) item.sources = normalizeSources(declaration.sources);
  if (own(declaration, 'share')) {
    const share = declaration.share;
    if (share !== null && (!Number.isInteger(share) || share < 1)) {
      fail('invalid_field', 'share must be a positive integer or null', { item: item.id, field: 'share' });
    }
    item.share_override = share;
  }
  item.share = item.share_override ?? WEIGHTS[item.weight];
  item.status = 'active';
  item.updated_at = item.updated_at ?? now;
}
function validateState(snapshot) {
  for (const item of Object.values(snapshot.items)) {
    requireText(item.title, 'title', 24);
    if (item.summary !== null && (typeof item.summary !== 'string' || [...item.summary].length > 60)) {
      fail('invalid_field', `Invalid summary on ${item.id}`, { item: item.id, field: 'summary' });
    }
    for (const field of ['due_at', 'stale_after']) if (item[field] !== null) timestamp(item[field], field);
    const seen = new Set([item.id]);
    let parent = item.parent_id;
    while (parent !== null) {
      if (seen.has(parent)) fail('cyclic_parent', `Cycle involving ${item.id}`, { item: item.id });
      seen.add(parent);
      const ancestor = knownItem(snapshot, parent);
      if (item.status === 'active' && ancestor.status !== 'active') {
        fail('inactive_parent', `Parent ${parent} is not active`, { item: item.id, parent });
      }
      parent = ancestor.parent_id;
    }
    if (item.status === 'active' && childrenOf(snapshot, item.id).length && !item.summary?.trim()) {
      fail('invalid_field', `Parent ${item.id} needs a summary`, { item: item.id, field: 'summary' });
    }
  }
  const layers = new Set([null, ...Object.values(snapshot.items).map(item => item.id)]);
  for (const parent of layers) {
    const items = childrenOf(snapshot, parent);
    const used = items.reduce((sum, item) => sum + item.share, 0);
    if (used > BUDGET) fail('budget_exceeded', `${parent ?? 'root'} uses ${used} / ${BUDGET}`, {
      layer: parent ?? 'root', budget: BUDGET, used, excess: used - BUDGET,
      shares: Object.fromEntries(items.map(item => [item.id, item.share])),
    });
  }
}
function appendAnnotation(snapshot, annotation) {
  requireText(annotation.id, 'annotation.id');
  requireText(annotation.text, 'annotation.text');
  const item = writableItem(snapshot, annotation.item);
  const at = annotation.at;
  timestamp(at, 'annotation.at');
  if (lookup(snapshot.annotations, annotation.id)) {
    fail('duplicate_annotation', `Annotation ${annotation.id} already exists`);
  }
  const stored = { id: annotation.id, item: item.id, author: annotation.author ?? 'user',
    text: annotation.text, created_at: at, status: 'saved', acknowledged_revision: null };
  put(snapshot.annotations, stored.id, stored);
  item.annotations.push(stored.id);
  snapshot.event_seq += 1;
  snapshot.events.push({ event_seq: snapshot.event_seq, type: 'annotation',
    batch_id: `annotation-${stored.id}`, actor: 'user', now: at,
    revision: snapshot.revision, changes: [{ op: 'annotation', item: item.id, annotation: copy(stored) }] });
}

function commit(snapshot, batch, now) {
  timestamp(now);
  if (!batch || typeof batch !== 'object') fail('invalid_batch', 'Every frame needs a batch');
  requireText(batch.batch_id, 'batch_id', 128);
  const actor = batch.actor ?? 'assistant';
  requireText(actor, 'actor');
  const declarations = batch.declarations ?? [];
  const acknowledges = batch.acknowledges ?? [];
  if (!Array.isArray(declarations) || !Array.isArray(acknowledges)) {
    fail('invalid_batch', 'declarations and acknowledges must be arrays');
  }
  const request = { command: 'commit', actor, declarations: copy(declarations), acknowledges: copy(acknowledges) };
  const previous = lookup(snapshot.receipts, batch.batch_id);
  if (previous) {
    const differing_fields = Object.keys(request).filter(field => !equal(request[field], previous.request[field]));
    if (differing_fields.length) fail('batch_id_conflict', `Batch ${batch.batch_id} differs`, {
      differing_fields, original_receipt: copy(previous.receipt),
    });
    return { snapshot, receipt: { ...copy(previous.receipt), batch_status: 'already_committed', events_appended: 0 } };
  }
  const candidate = copy(snapshot);
  const entries = [];
  const declared = new Set();
  function collect(list, parent = null, nested = false) {
    for (const declaration of list) {
      if (!declaration || typeof declaration.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(declaration.id)) {
        fail('invalid_field', 'Invalid declaration ID', { field: 'id', id: declaration?.id });
      }
      if (declared.has(declaration.id)) fail('duplicate_declaration', `Multiple declarations for ${declaration.id}`);
      declared.add(declaration.id);
      const relation = parseRelation(declaration);
      if (relation.type !== 'withdraw' && (!own(WEIGHTS, declaration.weight) || !KINDS.has(declaration.kind))) {
        fail('invalid_field', `${declaration.id} requires weight and kind`, { item: declaration.id });
      }
      entries.push({ declaration, relation, parent, nested });
      if (own(declaration, 'children')) {
        if (declaration.children !== null && !Array.isArray(declaration.children)) {
          fail('invalid_field', 'children must be an array or null', { item: declaration.id, field: 'children' });
        }
        collect(declaration.children ?? [], declaration.id, true);
      }
    }
  }
  collect(declarations);
  const withdrawals = new Set(entries.filter(entry => entry.relation.type === 'withdraw').map(entry => entry.declaration.id));
  const mergedSources = new Set();
  for (const { declaration: d, relation, parent, nested } of entries) {
    if (relation.type === 'withdraw') {
      writableItem(snapshot, d.id);
      requireText(d.reason, 'reason');
      continue;
    }
    let item;
    if (relation.type === 'supersedes') {
      if (relation.target !== d.id) fail('identity_mismatch', 'supersedes must retain the same ID', { item: d.id });
      const original = writableItem(snapshot, d.id);
      if (nested && original.parent_id !== parent) fail('unsupported_move', 'children cannot move an existing item', { item: d.id });
      item = candidate.items[d.id];
      if (WEIGHTS[d.weight] < WEIGHTS[original.weight] ||
          (own(d, 'share') && !equal(d.share, original.share_override))) requireText(d.reason, 'reason');
    } else {
      if (lookup(candidate.items, d.id)) fail('item_exists', `ID ${d.id} already exists`, { item: d.id });
      item = { id: d.id, title: null, summary: null, weight: d.weight, kind: d.kind,
        share_override: null, share: WEIGHTS[d.weight], status: 'active', parent_id: parent,
        reason: null, due_at: null, stale_after: null, sources: [], annotations: [],
        created_at: now, updated_at: now };
      candidate.items[d.id] = item;
    }
    if (own(d, 'share') && d.share !== null) requireText(d.reason, 'reason');
    applyFields(item, d, now);
    if (relation.type === 'merges') {
      const sources = relation.ids.map(id => writableItem(snapshot, id));
      if (sources.some(source => source.status !== 'active')) fail('inactive_merge_source', 'Merge sources must be active');
      if (sources.some(source => source.parent_id !== sources[0].parent_id)) {
        fail('merge_layer_mismatch', 'Merge sources must be in the same layer', { ids: relation.ids });
      }
      if (nested && parent !== sources[0].parent_id) fail('unsupported_move', 'Merge cannot move between layers');
      if (sources.some(source => childrenOf(snapshot, source.id, false).length) || d.children?.length) {
        fail('unsupported_merge_structure', 'Merge sources and result must be leaves without historical subtrees', { ids: relation.ids });
      }
      for (const source of sources) {
        if (declared.has(source.id) || mergedSources.has(source.id)) {
          fail('duplicate_declaration', `Merge source ${source.id} is modified more than once`);
        }
        mergedSources.add(source.id);
        candidate.items[source.id].status = 'merged';
        candidate.items[source.id].merged_into = d.id;
      }
      item.parent_id = sources[0].parent_id;
      item.sources = dedupe([...sources.flatMap(source => source.sources), ...item.sources]);
      item.annotations = [...new Set(sources.flatMap(source => source.annotations))];
    }
  }
  for (const id of withdrawals) {
    const affected = [id, ...descendants(candidate, id)];
    for (const affectedId of affected) {
      const item = candidate.items[affectedId];
      // Previously merged history remains merged and keeps its successor.
      if (item.status === 'active') item.status = 'withdrawn';
    }
    candidate.items[id].reason = entries.find(entry => entry.declaration.id === id).declaration.reason;
  }
  for (const { declaration: d, relation } of entries) {
    if (!own(d, 'children') || relation.type === 'withdraw') continue;
    const target = (d.children ?? []).filter(child => parseRelation(child).type !== 'withdraw').map(child => child.id).sort();
    const omitted = childrenOf(snapshot, d.id).filter(child => !target.includes(child.id) && !withdrawals.has(child.id));
    if (omitted.length) fail('explicit_withdraw_required', `Explicitly withdraw omitted children of ${d.id}`, {
      parent: d.id, omitted_children: omitted.map(child => child.id),
      affected_ids: omitted.flatMap(child => [child.id, ...descendants(snapshot, child.id, true)]),
    });
    const actual = childrenOf(candidate, d.id).map(child => child.id).sort();
    if (!equal(target, actual)) fail('invalid_children_target', `Final children differ from the target for ${d.id}`, { target, actual });
  }
  validateState(candidate);
  const newAcknowledges = [...new Set(acknowledges)].filter(id => {
    if (!lookup(candidate.annotations, id)) fail('annotation_not_found', `Unknown annotation ${id}`, { annotation: id });
    return candidate.annotations[id].status === 'saved';
  });
  const changedIds = [];
  for (const item of Object.values(candidate.items)) {
    const old = lookup(snapshot.items, item.id);
    if (!old || !equal(businessItem(snapshot, old), businessItem(candidate, item))) {
      changedIds.push(item.id);
      item.updated_at = now;
    } else {
      item.updated_at = old.updated_at;
      item.reason = old.reason;
    }
  }
  const type = changedIds.length ? 'commit' : newAcknowledges.length ? 'acknowledge' : 'checked';
  if (type !== 'checked') candidate.revision = nextRevision(snapshot.revision);
  for (const id of newAcknowledges) {
    candidate.annotations[id].status = 'acknowledged';
    candidate.annotations[id].acknowledged_revision = candidate.revision;
  }
  if (type === 'checked') {
    candidate.last_checked_at = now;
    candidate.last_checked_by_actor[actor] = now;
  }
  candidate.event_seq += 1;
  const changes = diffStates(projectState(snapshot, now), projectState(candidate, now)).changes;
  const receipt = { accepted: true, batch_status: 'committed', batch_id: batch.batch_id, actor, now,
    event_seq: candidate.event_seq, revision: candidate.revision, type, events_appended: 1,
    changes, changed_ids: changedIds, acknowledges: newAcknowledges };
  candidate.events.push({ event_seq: candidate.event_seq, batch_id: batch.batch_id, actor, now,
    revision: candidate.revision, type, changes: copy(changes), acknowledges: newAcknowledges });
  put(candidate.receipts, batch.batch_id, { request, receipt: copy(receipt) });
  return { snapshot: candidate, receipt };
}

/** Replay author-provided frames. Every returned snapshot is independent. */
export function replayScenario(scenario) {
  if (!Array.isArray(scenario?.frames)) fail('invalid_scenario', 'scenario.frames must be an array');
  let snapshot = initialSnapshot();
  return scenario.frames.map((frame, index) => {
    try {
      timestamp(frame.at, 'frame.at');
      if (frame.phase === 'initial') {
        const noAnnotations = frame.annotations === undefined ||
          (Array.isArray(frame.annotations) && frame.annotations.length === 0);
        if (index !== 0 || frame.batch !== null || !Array.isArray(frame.events) ||
            frame.events.length !== 0 || !noAnnotations) {
          fail('invalid_initial_frame', 'Only the first frame may be an empty initial view with batch:null');
        }
        const state = projectState(snapshot, frame.at);
        return { frame, index, snapshot: copy(snapshot), state, before: copy(state),
          receipt: null, diff: { changes: [] } };
      }
      const beforeSnapshot = copy(snapshot);
      const working = copy(snapshot);
      for (const annotation of frame.annotations ?? []) appendAnnotation(working, annotation);
      const result = commit(working, frame.batch, frame.at);
      snapshot = result.snapshot;
      const before = projectState(beforeSnapshot, frame.at);
      const state = projectState(snapshot, frame.at);
      return { frame, index, snapshot: copy(snapshot), before, state, receipt: copy(result.receipt),
        diff: diffStates(before, state) };
    } catch (error) {
      if (error instanceof FoldError) error.message = `Frame ${index} (${frame.id ?? frame.title}): ${error.message}`;
      throw error;
    }
  });
}

function rankItems(items) {
  return [...items].sort((a, b) => b.share - a.share ||
    Number(b.kind === 'needs-you') - Number(a.kind === 'needs-you') ||
    Date.parse(b.updated_at) - Date.parse(a.updated_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Full read projection. Duration values are seconds, and may be negative. */
export function projectState(snapshot, now) {
  const time = timestamp(now);
  const secondsSince = value => value === null ? null : (time - Date.parse(value)) / 1000;
  function itemView(item, rank = null) {
    const children = layer(item.id);
    return { ...copy(item), rank, children: children.items.length ? children : null,
      last_seen_at: null, since_seen: null, age: secondsSince(item.created_at),
      since_update: secondsSince(item.updated_at),
      until_due: item.due_at === null ? null : -secondsSince(item.due_at),
      until_stale: item.stale_after === null ? null : -secondsSince(item.stale_after) };
  }
  function layer(parent) {
    const items = rankItems(childrenOf(snapshot, parent));
    return { budget: BUDGET, used: items.reduce((sum, item) => sum + item.share, 0),
      items: items.map((item, index) => itemView(item, index + 1)) };
  }
  const annotations = Object.values(snapshot.annotations).map(copy);
  return { revision: snapshot.revision, event_seq: snapshot.event_seq, last_event_seq: snapshot.event_seq,
    root: layer(null), last_checked_at: snapshot.last_checked_at,
    last_seen_at: null, since_seen: null, annotations,
    annotation_status: Object.fromEntries(annotations.map(annotation => [annotation.id, annotation.status])),
    annotation_bound_to: Object.fromEntries(annotations.filter(annotation => annotation.acknowledged_revision)
      .map(annotation => [annotation.id, annotation.acknowledged_revision])),
    pending_annotations: annotations.filter(annotation => annotation.status === 'saved'),
    // Prototype inspection helper, not a second active layer or new product schema.
    historical: Object.values(snapshot.items).filter(item => item.status !== 'active').map(item => itemView(item)) };
}

function flattenState(state) {
  if (!state) return new Map();
  if (state.items && !state.root) return new Map(Object.entries(state.items));
  const items = new Map();
  function visit(item) {
    items.set(item.id, item);
    for (const child of item.children?.items ?? []) visit(child);
  }
  for (const item of state.root?.items ?? []) visit(item);
  for (const item of state.historical ?? []) visit(item);
  return items;
}

export function getItem(stateOrSnapshot, id) {
  return flattenState(stateOrSnapshot).get(id) ?? null;
}

/** Endpoint semantics only; advancing now, rank, or checked does not create a diff. */
export function diffStates(before, after) {
  const oldItems = flattenState(before);
  const newItems = flattenState(after);
  const changes = [];
  const project = item => item ? Object.fromEntries(BUSINESS_FIELDS.map(field => [field,
    field === 'children' ? (item.children?.items ?? []).map(child => child.id).sort() : item[field] ?? null,
  ])) : null;
  const annotationValues = (state, item) => {
    const annotations = Array.isArray(state?.annotations) ? state.annotations : Object.values(state?.annotations ?? {});
    return (item?.annotations ?? []).map(id => annotations.find(annotation => annotation.id === id) ?? { id });
  };
  for (const id of new Set([...oldItems.keys(), ...newItems.keys()])) {
    const oldItem = oldItems.get(id);
    const newItem = newItems.get(id);
    const oldValue = project(oldItem);
    const newValue = project(newItem);
    const fields = BUSINESS_FIELDS.filter(field => !equal(oldValue?.[field] ?? null, newValue?.[field] ?? null));
    if (fields.length || !oldItem || !newItem) {
      let type = !oldItem ? 'added' : !newItem || (oldItem.status === 'active' && newItem.status === 'withdrawn')
        ? 'withdrawn' : newItem.status === 'merged' && oldItem.status !== 'merged' ? 'merged'
          : oldItem.status !== 'active' && newItem.status === 'active' ? 'restored' : 'updated';
      changes.push({ item: id, type, fields,
        before: oldValue && Object.fromEntries(fields.map(field => [field, oldValue[field]])),
        after: newValue && Object.fromEntries(fields.map(field => [field, newValue[field]])) });
    }
    const oldAnnotations = annotationValues(before, oldItem);
    const newAnnotations = annotationValues(after, newItem);
    if (!equal(oldAnnotations, newAnnotations)) changes.push({ item: id, type: 'annotations_changed', fields: ['annotations'],
      before: oldItem ? { annotations: copy(oldAnnotations) } : null,
      after: newItem ? { annotations: copy(newAnnotations) } : null });
  }
  return { changes };
}

/** Squarified treemap. Pass the full ranked layer, then mask hidden entries in the UI.
 * All rectangles, including the genuine blank, retain exact share / budget area.
 * For filtered data, the caller must provide a neutral item for hidden shares.
 */
export function layoutTreemap(items, budget, width, height) {
  if (![budget, width, height].every(value => Number.isFinite(value) && value > 0)) {
    fail('invalid_layout', 'budget, width and height must be finite positive numbers');
  }
  const entries = items.filter(item => item.status === undefined || item.status === 'active').map(item => {
    if (!Number.isFinite(item.share) || item.share <= 0) fail('invalid_layout', `Invalid share for ${item.id}`);
    return { id: item.id, share: item.share, isBlank: false };
  });
  const used = entries.reduce((sum, item) => sum + item.share, 0);
  if (used > budget) fail('budget_exceeded', `Layout uses ${used} / ${budget}`, { budget, used });
  if (used < budget) entries.push({ id: '__blank__', share: budget - used, isBlank: true });
  // Keep the layer's state-rank order. Real items begin at the top-left;
  // the appended blank remains last instead of taking the leading corner.
  const areaPerShare = width * height / budget;
  const rectangles = [];
  let x = 0, y = 0, remainingWidth = width, remainingHeight = height;
  function worstAspect(row, side) {
    if (!row.length) return Infinity;
    const areas = row.map(item => item.share * areaPerShare);
    const sum = areas.reduce((total, area) => total + area, 0);
    return Math.max(side * side * Math.max(...areas) / (sum * sum),
      sum * sum / (side * side * Math.min(...areas)));
  }
  function placeRow(row, last, vertical = remainingWidth >= remainingHeight) {
    const area = row.reduce((sum, item) => sum + item.share * areaPerShare, 0);
    if (vertical) {
      const rowWidth = last ? remainingWidth : area / remainingHeight;
      let offset = y;
      row.forEach((item, index) => {
        const itemHeight = index === row.length - 1 ? y + remainingHeight - offset : item.share * areaPerShare / rowWidth;
        rectangles.push({ ...item, x, y: offset, width: rowWidth, height: itemHeight });
        offset += itemHeight;
      });
      x += rowWidth;
      remainingWidth -= rowWidth;
    } else {
      const rowHeight = last ? remainingHeight : area / remainingWidth;
      let offset = x;
      row.forEach((item, index) => {
        const itemWidth = index === row.length - 1 ? x + remainingWidth - offset : item.share * areaPerShare / rowHeight;
        rectangles.push({ ...item, x: offset, y, width: itemWidth, height: rowHeight });
        offset += itemWidth;
      });
      y += rowHeight;
      remainingHeight -= rowHeight;
    }
  }
  // Small prototype layers can inspect all order-preserving row breaks. Greedy squarify
  // only improves the current row and can leave its final sizable card a sliver.
  // This bounded lookahead minimizes the worst ratio of the complete partition.
  // Normal-or-larger cards get first priority: a one-share trace or an empty
  // region should not force a twelve-share card into a narrow strip.
  // Larger layers retain the ordinary linear-row squarify path below.
  if (entries.length <= 12) {
    function bestRows(start, w, h) {
      let best = null;
      for (let end = start + 1; end <= entries.length; end += 1) {
        const row = entries.slice(start, end);
        const area = row.reduce((sum, item) => sum + item.share * areaPerShare, 0);
        // Blank has no card body to fit. Trying either strip direction can leave
        // better-shaped space for the actual cards without changing its area.
        const directions = row.length === 1 && row[0].isBlank ? [w >= h, w < h] : [w >= h];
        for (const vertical of directions) {
          const thickness = area / (vertical ? h : w);
          const tail = end === entries.length ? { readableWorst: 0, worst: 0, total: 0, rows: [] }
            : bestRows(end, vertical ? w - thickness : w, vertical ? h : h - thickness);
          const ratios = row.map(item => {
            const length = item.share * areaPerShare / thickness;
            return Math.max(thickness / length, length / thickness);
          });
          const readableWorst = Math.max(tail.readableWorst, ...ratios.filter((ratio, index) =>
            !row[index].isBlank && row[index].share / budget >= 3 / 32));
          const worst = Math.max(...ratios, tail.worst);
          const total = ratios.reduce((sum, ratio) => sum + ratio, 0) + tail.total;
          if (!best || readableWorst < best.readableWorst - 1e-12 ||
              (Math.abs(readableWorst - best.readableWorst) < 1e-12 &&
                (worst < best.worst - 1e-12 || (Math.abs(worst - best.worst) < 1e-12 && total < best.total)))) {
            best = { readableWorst, worst, total, rows: [{ count: end - start, vertical }, ...tail.rows] };
          }
        }
      }
      return best;
    }
    const plan = bestRows(0, width, height);
    let start = 0;
    for (const { count, vertical } of plan.rows) {
      const end = start + count;
      placeRow(entries.slice(start, end), end === entries.length, vertical);
      start = end;
    }
    return rectangles;
  }
  let row = [];
  let index = 0;
  while (index < entries.length) {
    const side = Math.min(remainingWidth, remainingHeight);
    const next = [...row, entries[index]];
    if (!row.length || worstAspect(next, side) <= worstAspect(row, side)) {
      row = next;
      index += 1;
    } else {
      placeRow(row, false);
      row = [];
    }
  }
  if (row.length) placeRow(row, true);
  return rectangles;
}
