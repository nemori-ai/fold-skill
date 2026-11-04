import { h, onMounted, watch } from 'vue'
import { inBrowser, useData } from 'vitepress'
// Without VitePress's bundled Inter: the site uses system fonts plus two small self-hosted subsets (style.css).
import DefaultTheme from 'vitepress/theme-without-fonts'
import FoldLanding from './FoldLanding.vue'
import MermaidDiagram from './MermaidDiagram.vue'
import PrototypeLayer from './PrototypeLayer.vue'
import PrototypeMenu from './PrototypeMenu.vue'
import { restoreDemo } from './prototypes.mjs'
import './style.css'
import './why.css'

// The landing page is paper-white whatever the reader's appearance setting: it hides the switch and keeps the
// `dark` class off <html> while it is shown (config.mts drops VitePress's own pre-paint check on that page).
// The documents keep the switch; leaving the landing restores the reader's choice without touching it.
function useLandingAppearance() {
  const { frontmatter, isDark } = useData()
  if (!inBrowser) return
  const root = document.documentElement
  let observer = null
  const apply = () => {
    const landing = frontmatter.value.layout === 'FoldLanding'
    root.classList.toggle('fold-landing-page', landing)
    if (landing) {
      root.classList.remove('dark')
      observer ??= new MutationObserver(() => { if (root.classList.contains('dark')) root.classList.remove('dark') })
      observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    } else {
      observer?.disconnect()
      root.classList.toggle('dark', isDark.value)
    }
  }
  watch(() => frontmatter.value.layout, apply, { immediate: true })
  onMounted(apply)
}

export default {
  extends: DefaultTheme,
  // The prototype gallery panel and viewer are shared by every page: the nav opens them anywhere.
  Layout: {
    setup() {
      useLandingAppearance()
      // The demo the prototypes play (the address's ?data=, else this browser's last choice), once the page is up so the
      // server-rendered markup and hydration agree; the landing restores it first, from its own mounted hook.
      onMounted(restoreDemo)
      return () => h(DefaultTheme.Layout, null, { 'layout-bottom': () => h(PrototypeLayer) })
    },
  },
  enhanceApp({ app }) {
    app.component('FoldLanding', FoldLanding)
    app.component('MermaidDiagram', MermaidDiagram)
    app.component('PrototypeMenu', PrototypeMenu)
  },
}
