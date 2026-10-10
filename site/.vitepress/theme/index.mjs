import DefaultTheme from 'vitepress/theme'
import FoldHome from './Home.vue'
import MermaidDiagram from './MermaidDiagram.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('FoldHome', FoldHome)
    app.component('MermaidDiagram', MermaidDiagram)
  },
}
