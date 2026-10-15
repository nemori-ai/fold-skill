// all.html embeds every prototype page and steps them together. The parent posts {fold: 'go', frame: <index>};
// a page that follows calls its own frame function, and reports {fold: 'at', frame: <index>} whenever its frame
// changes, so the parent knows which pages are ready and where each one stands. A page opened on its own is untouched.
const embedded = globalThis.window !== undefined && window.parent !== window;
const origin = () => (location.origin === 'null' ? '*' : location.origin);

/** Listen for frame requests from the embedding page; returns `report(index)` to call after each frame change. */
export function followFrames(go) {
  if (!embedded) return () => {};
  addEventListener('message', event => {
    if (event.source !== window.parent || (location.origin !== 'null' && event.origin !== location.origin)) return;
    const { fold, frame } = event.data || {};
    if (fold === 'go' && Number.isInteger(frame)) go(frame);
  });
  let last = null;
  return index => {
    if (index === last) return;
    last = index;
    window.parent.postMessage({ fold: 'at', frame: index }, origin());
  };
}
