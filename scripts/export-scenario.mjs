// 把原型的手写演示情境以 JSON 打到 stdout，供 scripts/eval_judgment.py 与 scripts/build_corpus.py 读取。
// 只读取 prototype/data/story/scenario.mjs，不改动它；用法：node scripts/export-scenario.mjs > scenario.json
import { scenario } from '../prototype/data/story/scenario.mjs';

process.stdout.write(`${JSON.stringify(scenario, null, 2)}\n`);
