<script setup>
import { useRoute } from 'vitepress'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PrototypeGallery from './PrototypeGallery.vue'
import { closePrototype, combinedPage, datasetLabel, gallery, prototypes } from './prototypes.mjs'

// Mounted once in the layout: the gallery panel opened from the nav, and the viewer that loads a
// prototype page in place. The viewer is a native modal <dialog>, so it sits above the panel and
// the nav, keeps keyboard focus inside, and gives focus back when it closes.
const route = useRoute()
const panel = ref(null)
const dialog = ref(null)
const frame = ref(null)
const rendered = ref(false)   // the panel's images load only once it has been opened
const loaded = ref(false)
let returnFocus = null
let pressedBackdrop = false

function closeGallery(restore = true) {
  if (!gallery.open) return
  gallery.open = false
  if (restore) gallery.trigger?.focus({ preventScroll: true })
}

watch(() => gallery.open, async open => {
  if (!open) return
  rendered.value = true
  await nextTick()
  panel.value?.focus({ preventScroll: true })
})

// Keep focus moving out of the panel from leaving it open behind the page (the viewer is exempt).
function leavePanel(event) {
  const to = event.relatedTarget
  if (!to || gallery.current || panel.value?.contains(to) || to.closest?.('.fold-menu-bar')) return
  closeGallery(false)
}

watch(() => gallery.current, async (current, previous) => {
  const element = dialog.value
  if (!element) return
  if (current) {
    if (current !== previous) loaded.value = false
    if (!element.open) {
      returnFocus = document.activeElement
      await nextTick()
      element.showModal()
    }
  } else if (element.open) {
    element.close()
  }
})

function viewerClosed() {
  closePrototype()
  const target = returnFocus
  returnFocus = null
  if (target?.isConnected) target.focus({ preventScroll: true })
}

function pressDialog(event) {
  pressedBackdrop = event.target === dialog.value
}

function clickDialog(event) {
  if (pressedBackdrop && event.target === dialog.value) closePrototype()
  pressedBackdrop = false
}

function frameLoaded() {
  const view = frame.value?.contentWindow
  // Same-origin pages: Esc pressed inside the prototype closes the viewer too, and the arrow keys
  // step frames right away because focus starts in the page.
  try {
    view.addEventListener('keydown', event => { if (event.key === 'Escape') closePrototype() })
    view.focus()
  } catch {}
  setTimeout(() => { loaded.value = true }, 60)
}

// Continue in a new tab where the viewer stands now: same frame, version switcher and concept card back.
function openInTab(event) {
  try {
    const url = new URL(frame.value.contentWindow.location.href)
    if (url.origin !== location.origin || url.protocol === 'about:') return
    url.searchParams.delete('embed')
    url.searchParams.delete('card')
    event.currentTarget.href = `${url.pathname}${url.search}${url.hash}`
  } catch {}
}

// Scroll stays with the panel or the viewer while either is open.
function lockScroll(locked) {
  const root = document.documentElement
  if (locked) {
    const gap = window.innerWidth - root.clientWidth
    root.style.overflow = 'hidden'
    if (gap > 0) root.style.paddingRight = `${gap}px`
  } else {
    root.style.overflow = ''
    root.style.paddingRight = ''
  }
}

function keydown(event) {
  if (event.key === 'Escape' && gallery.open && !gallery.current) closeGallery()
}

watch(() => route.path, () => {
  closePrototype()
  closeGallery(false)
})

onMounted(() => {
  watch(() => gallery.open || Boolean(gallery.current), lockScroll, { immediate: true })
  document.addEventListener('keydown', keydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', keydown)
  lockScroll(false)
})
</script>

<template>
  <Transition name="fold-fade">
    <div v-show="gallery.open" class="fold-panel-backdrop" aria-hidden="true" @click="closeGallery()" />
  </Transition>
  <Transition name="fold-panel">
    <div
      v-show="gallery.open"
      id="fold-prototype-panel"
      ref="panel"
      class="fold-panel"
      role="dialog"
      aria-labelledby="fold-panel-title"
      tabindex="-1"
      @focusout="leavePanel"
    >
      <div class="fold-panel-inner">
        <header class="fold-panel-head">
          <div class="fold-panel-heading">
            <h2 id="fold-panel-title">原型体验</h2>
            <p>{{ prototypes.length }} 个原型共用同一份回放。点卡片在本页打开，可以逐帧回放、悬停查看、就地回应。</p>
          </div>
          <div class="fold-panel-actions">
            <a class="fold-panel-link" :href="combinedPage" target="_self">合页（全部形式一页）<span aria-hidden="true">↗</span></a>
            <button type="button" class="fold-icon-button fold-panel-close" aria-label="收起原型体验" @click="closeGallery()">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            </button>
          </div>
        </header>
        <PrototypeGallery v-if="rendered" />
        <p class="fold-panel-note">默认数据：{{ datasetLabel }}。这些形式都没有选定。</p>
      </div>
    </div>
  </Transition>

  <dialog
    ref="dialog"
    class="fold-viewer"
    aria-labelledby="fold-viewer-title"
    @close="viewerClosed"
    @pointerdown="pressDialog"
    @click="clickDialog"
  >
    <div v-if="gallery.current" class="fold-viewer-box">
      <header class="fold-viewer-bar">
        <span class="fold-viewer-no">{{ gallery.current.no }}</span>
        <h2 id="fold-viewer-title">{{ gallery.current.name }}</h2>
        <p class="fold-viewer-line">{{ gallery.current.line }}</p>
        <a class="fold-viewer-open" :href="gallery.current.href" target="_blank" rel="noopener" @click="openInTab">
          新标签页<span class="fold-viewer-open-long">打开</span><span aria-hidden="true">↗</span>
        </a>
        <button type="button" class="fold-icon-button" aria-label="关闭" @click="closePrototype">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
        </button>
      </header>
      <div class="fold-viewer-stage" :class="{ 'is-loaded': loaded }">
        <img class="fold-viewer-placeholder" :src="gallery.current.preview" alt="" aria-hidden="true">
        <span class="fold-viewer-wait" role="status">载入{{ gallery.current.name }}…</span>
        <iframe
          :key="gallery.current.id"
          ref="frame"
          :src="gallery.current.src"
          :title="gallery.current.name"
          allow="fullscreen"
          @load="frameLoaded"
        />
      </div>
    </div>
  </dialog>
</template>

<style>
/* ---------- gallery panel ---------- */
.fold-panel-backdrop {
  position: fixed;
  inset: var(--vp-nav-height) 0 0;
  z-index: 28;
  background: oklch(0.2 0.015 155 / 0.32);
}

.dark .fold-panel-backdrop {
  background: oklch(0.1 0.01 155 / 0.55);
}

.fold-panel {
  position: fixed;
  top: var(--vp-nav-height);
  right: 0;
  left: 0;
  z-index: 29;
  overflow: auto;
  max-height: calc(100dvh - var(--vp-nav-height));
  border-top: 1px solid var(--vp-c-divider);
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  box-shadow: 0 28px 48px -28px oklch(0.2 0.02 150 / 0.45);
  overscroll-behavior: contain;
}

.fold-panel:focus {
  outline: none;
}

.fold-panel-inner {
  max-width: calc(var(--vp-layout-max-width) - 64px);
  margin: 0 auto;
  padding: 20px 32px 22px;
}

.fold-panel-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px 24px;
  margin-bottom: 18px;
}

.fold-panel-heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 2px 14px;
  min-width: 0;
}

.fold-panel-heading h2 {
  margin: 0;
  color: var(--vp-c-text-1);
  font-size: 17px;
  font-weight: 600;
  line-height: 1.5;
  letter-spacing: -0.02em;
}

.fold-panel-heading p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.6;
}

.fold-panel-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
}

.fold-panel-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 36px;
  padding: 0 4px;
  color: var(--vp-c-brand-1);
  font-size: 13px;
  font-weight: 500;
  text-decoration: underline;
  text-decoration-color: var(--vp-c-border);
  text-underline-offset: 4px;
  white-space: nowrap;
}

.fold-panel-link:hover {
  color: var(--vp-c-brand-2);
  text-decoration-color: currentColor;
}

.fold-panel-link:focus-visible,
.fold-icon-button:focus-visible,
.fold-viewer-open:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
  border-radius: 4px;
}

.fold-icon-button {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  color: var(--vp-c-text-2);
  font-size: 18px;
  transition: background-color 0.2s, color 0.2s;
}

.fold-icon-button:hover {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-1);
}

.fold-panel-note {
  margin: 18px 0 0;
  color: var(--vp-c-text-3);
  font-size: 12px;
  line-height: 1.7;
}

.fold-panel-enter-active,
.fold-panel-leave-active,
.fold-fade-enter-active,
.fold-fade-leave-active {
  transition: opacity 180ms var(--fold-ease), transform 220ms var(--fold-ease);
}

.fold-panel-enter-from,
.fold-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.fold-fade-enter-from,
.fold-fade-leave-to {
  opacity: 0;
}

/* Below 960 px the nav scrolls with the page: the gallery becomes a full-screen sheet. */
@media (max-width: 959px) {
  .fold-panel-backdrop {
    display: none;
  }

  .fold-panel {
    inset: 0;
    z-index: 100;
    max-height: none;
    border: 0;
    box-shadow: none;
  }

  .fold-panel-inner {
    padding: 0 24px 28px;
  }

  .fold-panel-head {
    position: sticky;
    top: 0;
    z-index: 1;
    align-items: center;
    margin: 0 -24px 16px;
    padding: 10px 16px 10px 24px;
    border-bottom: 1px solid var(--vp-c-divider);
    background: var(--vp-c-bg);
  }

  .fold-panel-heading p {
    display: none;
  }
}

@media (min-width: 960px) {
  .fold-panel-close {
    display: none;
  }
}

@media (max-width: 639px) {
  .fold-panel-inner {
    padding: 0 16px 24px;
  }

  .fold-panel-head {
    margin: 0 -16px 14px;
    padding: 8px 8px 8px 16px;
  }

  .fold-panel-link {
    font-size: 12px;
  }
}

/* ---------- viewer ---------- */
.fold-viewer {
  position: fixed;
  inset: 0;
  width: 100%;
  max-width: none;
  height: 100%;
  max-height: none;
  margin: 0;
  padding: 24px;
  border: 0;
  overflow: hidden;
  color: var(--vp-c-text-1);
  background: transparent;
}

.fold-viewer[open] {
  display: flex;
}

.fold-viewer::backdrop {
  background: rgb(16 22 19 / 0.6);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.fold-viewer-box {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: 12px;
  background: var(--vp-c-bg-elv);
  box-shadow: 0 30px 90px -20px rgb(0 0 0 / 0.55);
  animation: fold-viewer-in 240ms var(--fold-ease);
}

.fold-viewer-bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  min-height: 50px;
  padding: 6px 8px 6px 18px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.fold-viewer-no {
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

.fold-viewer-bar h2 {
  flex: none;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -0.015em;
}

.fold-viewer-line {
  flex: 1;
  overflow: hidden;
  min-width: 0;
  margin: 0 0 0 4px;
  color: var(--vp-c-text-2);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fold-viewer-open {
  display: inline-flex;
  flex: none;
  align-items: center;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-brand-1);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  transition: border-color 0.2s, color 0.2s;
}

.fold-viewer-open:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-2);
}

.fold-viewer-open > span[aria-hidden] {
  margin-left: 5px;
}

.fold-viewer-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}

.fold-viewer-placeholder {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top center;
  opacity: 0.5;
  filter: blur(8px) saturate(0.85);
  transform: scale(1.03);
}

.fold-viewer-wait {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.fold-viewer-stage iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  opacity: 0;
  transition: opacity 280ms var(--fold-ease);
}

.fold-viewer-stage.is-loaded iframe {
  opacity: 1;
}

.fold-viewer-stage.is-loaded .fold-viewer-wait {
  visibility: hidden;
}

@keyframes fold-viewer-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
  }
}

@media (max-width: 767px) {
  .fold-viewer {
    padding: 0;
  }

  .fold-viewer-box {
    border-radius: 0;
  }

  .fold-viewer-bar {
    padding-left: 14px;
  }

  .fold-viewer-line,
  .fold-viewer-open-long {
    display: none;
  }

  .fold-viewer-bar h2 {
    flex: 1;
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fold-viewer-box {
    animation: none;
  }

  .fold-viewer-stage iframe,
  .fold-panel-enter-active,
  .fold-panel-leave-active,
  .fold-fade-enter-active,
  .fold-fade-leave-active {
    transition: none;
  }
}
</style>
