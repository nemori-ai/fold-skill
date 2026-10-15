// The replayed demo data. Pages import this module; ?data=<name> picks the dataset (data/select.mjs).
// Each dataset module exports `scenario` with the same shape: persona, frames with events, batch,
// asks, feedback and signal. The replay engine and every form read only this shape.
import { currentDataset, datasets, keepDataset } from './data/select.mjs';

export const dataset = currentDataset();
const module = await import(new URL(`./data/${datasets[dataset].module.replace(/^\.\//, '')}`, import.meta.url).href);
export const scenario = module.scenario;
export const notice = datasets[dataset].notice;
keepDataset();
export default scenario;
