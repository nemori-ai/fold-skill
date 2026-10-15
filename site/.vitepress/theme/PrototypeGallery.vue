<script setup>
import { openPrototype, prototypes } from './prototypes.mjs'

defineProps({
  // `compact` fills the nav panel (seven across at 1440 wide); `large` is the home page's three across.
  size: { type: String, default: 'compact' },
})

// A plain click opens the viewer in place; modified and middle clicks keep the link's own behaviour.
function open(event, prototype) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  openPrototype(prototype)
}
</script>

<template>
  <ul class="fold-gallery" :class="`is-${size}`">
    <li v-for="prototype in prototypes" :key="prototype.id">
      <a class="fold-gallery-card" :href="prototype.href" target="_self" @click="open($event, prototype)">
        <span class="fold-gallery-thumb">
          <img :src="prototype.preview" alt="" width="640" height="400" loading="lazy" decoding="async">
        </span>
        <span class="fold-gallery-text">
          <span class="fold-gallery-name">
            <span class="fold-gallery-no">{{ prototype.no }}</span>
            <span class="fold-gallery-title">{{ prototype.name }}</span>
            <span v-if="prototype.withdrawn" class="fold-gallery-tag">已撤下</span>
          </span>
          <span class="fold-gallery-line">{{ prototype.line }}</span>
        </span>
      </a>
    </li>
  </ul>
</template>

<style>
.fold-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 20px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fold-gallery > li {
  min-width: 0;
  margin: 0;
}

.fold-gallery-card {
  display: block;
  height: 100%;
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
  transition: transform 220ms var(--fold-ease);
}

.fold-gallery-thumb {
  display: block;
  overflow: hidden;
  aspect-ratio: 16 / 10;
  border: 1px solid var(--vp-c-divider);
  border-radius: 7px;
  background: var(--vp-c-bg-soft);
  box-shadow: 0 1px 2px oklch(0.25 0.02 150 / 0.06);
  transition: border-color 220ms var(--fold-ease), box-shadow 220ms var(--fold-ease);
}

.fold-gallery-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top center;
}

.fold-gallery-text {
  display: block;
  padding: 9px 2px 0;
}

.fold-gallery-name {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
  letter-spacing: -0.01em;
}

.fold-gallery-no {
  flex: none;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0;
}

.fold-gallery-title {
  overflow: hidden;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fold-gallery-tag {
  flex: none;
  margin-left: auto;
  color: var(--vp-c-text-3);
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0;
}

.fold-gallery-line {
  display: -webkit-box;
  overflow: hidden;
  margin-top: 2px;
  color: var(--vp-c-text-2);
  font-size: 12px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.fold-gallery-card:hover {
  transform: translateY(-3px);
}

.fold-gallery-card:hover .fold-gallery-thumb {
  border-color: var(--vp-c-border);
  box-shadow: 0 12px 26px -12px oklch(0.25 0.03 150 / 0.38);
}

.fold-gallery-card:hover .fold-gallery-title {
  color: var(--vp-c-brand-1);
}

.fold-gallery-card:active {
  transform: translateY(-1px);
}

.fold-gallery-card:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 4px;
}

.dark .fold-gallery-card:hover .fold-gallery-thumb {
  box-shadow: 0 14px 30px -12px oklch(0 0 0 / 0.7);
}

.fold-gallery.is-large {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 36px 28px;
}

.fold-gallery.is-large .fold-gallery-thumb {
  border-radius: 8px;
}

.fold-gallery.is-large .fold-gallery-text {
  padding-top: 12px;
}

.fold-gallery.is-large .fold-gallery-name {
  gap: 9px;
  font-size: 16px;
}

.fold-gallery.is-large .fold-gallery-no {
  font-size: 12px;
}

.fold-gallery.is-large .fold-gallery-tag {
  font-size: 12px;
}

.fold-gallery.is-large .fold-gallery-line {
  margin-top: 3px;
  font-size: 13px;
  line-height: 1.7;
}

@media (max-width: 959px) {
  .fold-gallery.is-large {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 28px 20px;
  }
}

@media (max-width: 639px) {
  .fold-gallery,
  .fold-gallery.is-large {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px 12px;
  }

  .fold-gallery.is-large .fold-gallery-name {
    font-size: 14px;
  }

  .fold-gallery.is-large .fold-gallery-line {
    font-size: 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fold-gallery-card,
  .fold-gallery-thumb {
    transition: none;
  }

  .fold-gallery-card:hover,
  .fold-gallery-card:active {
    transform: none;
  }
}
</style>
