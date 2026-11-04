<script setup>
// Which demo the site's examples play (prototypes.mjs `demo`; site/landing/spec.md「切换演示数据」): two buttons with
// plain names, and under them the one line that says where the chosen demo's people and messages come from (written
// by the author, or rewritten from real public text). The landing has it at the head of the example section and of
// the live six, the nav's prototype panel at its foot: one choice, wherever it is made. Names and lines are the demos'
// own (data.json datasets.<name>.copy), so a reader never sees a person's name here.
import { computed } from 'vue'
import data from '../../landing/data.json'
import { chooseDemo, demo } from './prototypes.mjs'

const options = Object.entries(data.datasets).map(([name, d]) => ({ name, label: d.copy.value.label, from: d.copy.value.provenance }))
const current = computed(() => options.find(o => o.name === demo.data) ?? options[0])
</script>

<template>
  <div class="fold-demo" role="group" aria-label="演示数据">
    <span class="fold-demo-label" aria-hidden="true">演示数据</span>
    <span class="fold-demo-opts">
      <button v-for="o in options" :key="o.name" type="button" :data-demo="o.name" :aria-pressed="String(o.name === current.name)" @click="chooseDemo(o.name)">{{ o.label }}</button>
    </span>
    <p class="fold-demo-from" data-k="copy.provenance">{{ current.from }}</p>
  </div>
</template>

<style>
/* One control of two halves on the page's paper and ink (the landing's tokens; the docs' theme colours elsewhere):
   the chosen half filled with ink, no vermilion (it is not waiting for you). Each half is a 44 px touch target. */
.fold-demo { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 8px 12px; margin-top: 18px; }
.fold-demo-label { font: 11px/1.4 var(--mono, var(--vp-font-family-mono)); letter-spacing: 0.06em; color: var(--ink-2, var(--vp-c-text-2)); }
.fold-demo-opts { display: inline-flex; justify-self: start; overflow: hidden; border: 1.5px solid var(--ink, var(--vp-c-text-1)); border-radius: 999px; }
.fold-demo-opts button { min-height: 44px; padding: 0 16px; border: 0; background: none; color: var(--ink-2, var(--vp-c-text-2)); font: 600 14px/1 var(--sans, var(--vp-font-family-base)); white-space: nowrap; cursor: pointer; transition: background-color 160ms ease-out, color 160ms ease-out; }
.fold-demo-opts button + button { border-left: 1.5px solid var(--ink, var(--vp-c-text-1)); }
.fold-demo-opts button[aria-pressed="true"] { background: var(--ink, var(--vp-c-text-1)); color: var(--paper, var(--vp-c-bg)); cursor: default; }
.fold-demo .fold-demo-opts button:focus-visible { outline: 2px solid var(--ink, var(--vp-c-text-1)); outline-offset: -5px; }
.fold-demo .fold-demo-opts button[aria-pressed="true"]:focus-visible { outline-color: var(--paper, var(--vp-c-bg)); }
@media (hover: hover) { .fold-demo-opts button[aria-pressed="false"]:hover { color: var(--ink, var(--vp-c-text-1)); text-decoration: underline; text-underline-offset: 3px; } }
.fold-demo-from { grid-column: 1 / -1; max-width: 40em; margin: 0; font-size: 13px; line-height: 1.6; color: var(--ink-2, var(--vp-c-text-2)); }
@media (prefers-reduced-motion: reduce) { .fold-demo-opts button { transition: none; } }
</style>
