// Which demo dataset a prototype page replays. `?data=<name>` chooses one; every page of the
// prototype (原版、A/B/C/D、形式画廊与草图) reads the same choice, and links inside the prototype keep it.
// Datasets share one shape: see prototype/README.md「演示数据」. `notice` is the one-line provenance
// every page shows next to the data.
export const datasets = {
  composite: {
    label: '真实语料 · Jonas Berglund 的两周',
    module: './composite/scenario.mjs',
    notice: '人物是化名拼成的；输入是化名改写后的真实公开数据，正文截到 500 字；Agent 判断来自一次真实模型的自由运行，再经人工打磨（见 POLISH.md）。',
  },
  story: {
    label: '手写情境 · 林苒的两周',
    module: './story/scenario.mjs',
    notice: '人物、私人消息与 Agent 判断均为演示创作，假设 Agent 已经作出了合适的整理判断；它检验状态演变与阅读体验，不评估真实模型能力。',
  },
};
export const defaultDataset = 'composite';
export const datasetNotice = () => datasets[currentDataset()].notice;

const params = () => new URLSearchParams(globalThis.location?.search || '');
export function currentDataset() {
  const requested = params().get('data');
  return Object.hasOwn(datasets, requested ?? '') ? requested : defaultDataset;
}

/** Add the current ?data= to a same-site URL that does not name a dataset itself. */
export function withDataset(href, base = globalThis.location?.href) {
  const name = currentDataset();
  if (name === defaultDataset || !href || !base) return href;
  const url = new URL(href, base);
  if (url.origin !== new URL(base).origin || url.searchParams.has('data') || !/\.html$|\/$/.test(url.pathname)) return href;
  url.searchParams.set('data', name);
  return `${url.pathname}${url.search}${url.hash}`;
}

let kept = false;
/** Keep a non-default choice across in-prototype navigation, including links rendered later. */
export function keepDataset() {
  if (kept || !globalThis.document || currentDataset() === defaultDataset) return;
  kept = true;
  const rewrite = event => {
    const link = event.target.closest?.('a[href]');
    if (link && !link.target?.startsWith('_blank')) link.setAttribute('href', withDataset(link.getAttribute('href')));
  };
  document.addEventListener('click', rewrite, true);
  document.addEventListener('auxclick', rewrite, true);
}
