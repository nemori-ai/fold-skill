<script setup>
import { inject } from 'vue'
import { gallery, toggleGallery } from './prototypes.mjs'

// VitePress renders a component nav item twice: in the bar and, with `screenMenu`, in the mobile menu.
const props = defineProps({ screenMenu: Boolean })
const closeScreen = inject('close-screen', null)

function toggle(event) {
  if (props.screenMenu) {
    // The mobile menu gives way to the full-screen gallery.
    closeScreen?.()
    gallery.trigger = null
    gallery.open = true
    return
  }
  toggleGallery(event.currentTarget)
}
</script>

<template>
  <button
    type="button"
    :class="screenMenu ? 'fold-menu-screen' : 'fold-menu-bar'"
    :aria-expanded="gallery.open"
    aria-controls="fold-prototype-panel"
    @click="toggle"
  >
    <span>原型体验</span>
    <span class="vpi-chevron-down fold-menu-caret" aria-hidden="true" />
  </button>
</template>

<style>
.fold-menu-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: var(--vp-nav-height);
  padding: 0 12px;
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 500;
  line-height: var(--vp-nav-height);
  transition: color 0.25s;
}

.fold-menu-bar:hover,
.fold-menu-bar[aria-expanded="true"] {
  color: var(--vp-c-brand-1);
}

.fold-menu-bar > span:first-child {
  line-height: 24px;
}

.fold-menu-bar:focus-visible {
  outline: none;
}

.fold-menu-bar:focus-visible > span:first-child,
.fold-menu-screen:focus-visible > span:first-child {
  border-radius: 4px;
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 4px;
}

.fold-menu-screen:focus-visible {
  outline: none;
}

.fold-menu-caret {
  font-size: 14px;
  transition: transform 0.25s var(--fold-ease);
}

/* VitePress draws chevron-down as chevron-right turned 90°; open turns it to point up. */
.fold-menu-bar[aria-expanded="true"] .fold-menu-caret {
  transform: rotate(-90deg);
}

.fold-menu-screen {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 12px 0 11px;
  border-bottom: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 500;
  line-height: 24px;
  text-align: left;
  transition: color 0.25s;
}

.fold-menu-screen:hover {
  color: var(--vp-c-brand-1);
}

.fold-menu-screen .fold-menu-caret {
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .fold-menu-caret {
    transition: none;
  }
}
</style>
