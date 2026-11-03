// all.html embeds every prototype page and steps them together. The parent posts {fold: 'go', frame: <index>};
// a page that follows calls its own frame function, and reports {fold: 'at', frame: <index>} whenever its frame
// changes, so the parent knows which pages are ready and where each one stands. A page opened on its own is untouched.
// Messages carry only a frame index and are matched by their source window, not by origin: the single-file export
// (scripts/export-all.mjs) runs every page from srcdoc under file://, where origins are opaque.
//
// ?embed=show: the site's landing page plays a page as a picture (FoldLanding.vue): the page hides its own controls
// (version switcher, frame stepper, concept card, buttons) and only follows frames. Once it has drawn its first view
// it also posts {fold: 'shown'}, so the landing can swap its still image for the live page without a blank moment.
// Embedded that way, an animation loop sleeps while nothing on the page changes (see sleepLoops below).
const embedded = globalThis.window !== undefined && window.parent !== window;

/** True when the page is played as a picture (?embed=show; opened on its own too, which is how the stills are shot). */
export const showing = globalThis.location !== undefined && new URLSearchParams(location.search).get('embed') === 'show';

const nativeFrame = globalThis.requestAnimationFrame?.bind(globalThis);
if (embedded && showing) sleepLoops();

// Played as a picture, a page changes only when the landing moves it to another frame, yet some pages keep an
// animation loop running every frame while nothing moves (the hover machinery of forms/motion/ix.mjs redraws its
// pointer line each frame). Six such pages in the landing's process would cost it a page's frame work per page per
// frame. So a loop sleeps: a frame asked for from inside a frame callback is held back once nothing woke the page for
// AWAKE ms and its DOM has had no real change for QUIET ms. A message (the next frame), a resize or a real change
// lets the held callbacks run again; a frame asked for anywhere else (a one-off) always runs.
function sleepLoops() {
  const QUIET = 500, AWAKE = 2000;
  const nativeCancel = cancelAnimationFrame.bind(window);
  const held = new Map();
  let woke = performance.now(), changed = woke, inFrame = 0, nextId = 1e9;
  const release = () => { const list = [...held.values()]; held.clear(); for (const fn of list) request(fn, true); };
  function request(fn, force = false) {
    const now = performance.now();
    if (!force && inFrame && now - woke > AWAKE && now - changed > QUIET) { nextId += 1; held.set(nextId, fn); return nextId; }
    return nativeFrame(t => { inFrame += 1; try { fn(t); } finally { inFrame -= 1; } });
  }
  window.requestAnimationFrame = fn => request(fn);
  window.cancelAnimationFrame = id => { if (!held.delete(id)) nativeCancel(id); };
  const wake = () => { woke = performance.now(); release(); };
  addEventListener('message', wake);
  addEventListener('resize', wake);
  // A real change: a node added or removed, or an attribute or text set to a different value (the same value set
  // again every frame is not one).
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'childList' || (r.type === 'attributes' ? r.oldValue !== r.target.getAttribute(r.attributeName) : r.oldValue !== r.target.data)) {
        changed = performance.now();
        if (held.size) release();
        return;
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true });
}

/** Listen for frame requests from the embedding page; returns `report(index)` to call after each frame change. */
export function followFrames(go) {
  if (!embedded) return () => {};
  addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const { fold, frame } = event.data || {};
    if (fold === 'go' && Number.isInteger(frame)) go(frame);
  });
  let last = null;
  return index => {
    if (index === last) return;
    last = index;
    window.parent.postMessage({ fold: 'at', frame: index }, '*');
  };
}

/** Call once the page has mounted its view: tells the embedding page after the next paint. */
export function shown() {
  if (!embedded) return;
  nativeFrame(() => nativeFrame(() => window.parent.postMessage({ fold: 'shown' }, '*')));
}
