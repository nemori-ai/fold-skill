import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import FoldHome from './Home.vue'
import MermaidDiagram from './MermaidDiagram.vue'
import PrototypeLayer from './PrototypeLayer.vue'
import PrototypeMenu from './PrototypeMenu.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  // The prototype gallery panel and viewer are shared by every page: the nav opens them anywhere.
  Layout: () => h(DefaultTheme.Layout, null, { 'layout-bottom': () => h(PrototypeLayer) }),
  enhanceApp({ app }) {
    app.component('FoldHome', FoldHome)
    app.component('MermaidDiagram', MermaidDiagram)
    app.component('PrototypeMenu', PrototypeMenu)
  },
}
