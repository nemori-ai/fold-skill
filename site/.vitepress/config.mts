import { defineConfig } from 'vitepress';

const favicon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#315b4a"/><path d="M9 7h15v4H13v5h9v4h-9v6H9z" fill="#f6f5ee"/></svg>');

export default defineConfig({
  lang: 'zh-CN',
  title: 'Fold',
  description: 'Fold 的产品设计、信息契约与交互原型：将多源信息整理成有注意力预算的结构化状态。',
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: favicon }]],
  srcDir: '.generated',
  // VitePress resolves outDir relative to the site root, not this config file.
  outDir: '../dist',
  cleanUrls: true,
  ignoreDeadLinks: false,
  lastUpdated: false,
  markdown: {
    // Enables both MathJax rendering and VitePress's mjx-* custom-element compiler handling.
    math: true,
    config(md) {
      // Existing specifications use both \(inline TeX\) and $$ display TeX.
      // Keep source notation unchanged and reuse MathJax's SVG token renderer.
      md.inline.ruler.before('escape', 'fold_math_parentheses', (state, silent) => {
        if (state.src.slice(state.pos, state.pos + 2) !== '\\(') return false;
        const end = state.src.indexOf('\\)', state.pos + 2);
        if (end < 0) return false;
        if (!silent) {
          const token = state.push('math_inline', 'math', 0);
          token.content = state.src.slice(state.pos + 2, end);
        }
        state.pos = end + 2;
        return true;
      });
      const htmlInline = md.renderer.rules.html_inline!;
      const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
      md.renderer.rules.html_inline = (tokens, index, options, env, self) => {
        const content = tokens[index].content;
        const bareTag = content.match(/^<([a-z][\w-]*)>$/i);
        // A bare command placeholder such as <id> is prose, not a Vue element.
        // Paired inline HTML and standard void elements keep their semantics.
        if (bareTag && !voidTags.has(bareTag[1].toLowerCase())
          && !tokens.slice(index + 1).some(token => token.type === 'html_inline' && token.content.toLowerCase() === `</${bareTag[1].toLowerCase()}>`)) {
          return md.utils.escapeHtml(content);
        }
        return htmlInline(tokens, index, options, env, self);
      };
      const fence = md.renderer.rules.fence!;
      md.renderer.rules.fence = (tokens, index, options, env, self) => {
        const token = tokens[index];
        if (token.info.trim() !== 'mermaid') return fence(tokens, index, options, env, self);
        return `<MermaidDiagram :code="${md.utils.escapeHtml(JSON.stringify(token.content))}" />\n`;
      };
      const linkOpen = md.renderer.rules.link_open;
      md.renderer.rules.link_open = (tokens, index, options, env, self) => {
        if (tokens[index].attrGet('href')?.startsWith('/prototype/')) {
          tokens[index].attrSet('data-vp-ignore', '');
          tokens[index].attrSet('target', '_self');
        }
        return linkOpen ? linkOpen(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
      };
    },
  },
  themeConfig: {
    siteTitle: 'Fold',
    nav: [
      { text: '概览', link: '/overview' },
      { text: '产品文档', link: '/docs/product', activeMatch: '^/docs/' },
      { text: '原型体验', items: [
        { text: 'A · 空间排布', link: '/prototype/?variant=a&frame=0', target: '_self' },
        { text: 'B · 时间展开', link: '/prototype/?variant=b&frame=0', target: '_self' },
        { text: 'C · 流动形态', link: '/prototype/?variant=c&frame=0', target: '_self' },
        { text: '原版 · 完整工作台', link: '/prototype/', target: '_self' },
      ] },
      { text: '原型说明', link: '/prototype-notes/README', activeMatch: '^/prototype-notes/' },
    ],
    sidebar: [
      { text: '产品', items: [
        { text: '项目概览', link: '/overview' },
        { text: '产品方向', link: '/docs/product' },
        { text: '用户故事', link: '/docs/user-stories' },
        { text: 'Skill 设计', link: '/docs/skill-design' },
      ] },
      { text: '协议与模型', items: [
        { text: '领域模型', link: '/docs/domain-model' },
        { text: '信息契约', link: '/docs/information-contract' },
        { text: '架构与持久化', link: '/docs/architecture' },
        { text: '形式模型', link: '/docs/formal-model' },
        { text: '决策记录', link: '/docs/decisions' },
      ] },
      { text: '开发', items: [
        { text: '工作环境', link: '/docs/development' },
        { text: '开发协作约定', link: '/agents' },
        { text: '一致性用例', link: '/conformance/cases/' },
        { text: '配图索引', link: '/docs/visual-guide' },
        { text: '配图来源与提示词', link: '/docs/assets/illustrations/README' },
        { text: '历史草案 v0.3', link: '/docs/reference/design-v0.3' },
      ] },
      { text: '原型', items: [
        { text: '使用说明', link: '/prototype-notes/README' },
        { text: '演示情境', link: '/prototype-notes/STORY' },
        { text: '原型产品定义', link: '/prototype-notes/PRODUCT' },
        { text: '原版视觉规范', link: '/prototype-notes/DESIGN' },
        { text: '三种视觉表达', link: '/prototype-notes/EXPLORATIONS' },
        { text: 'Three.js 依赖说明', link: '/prototype-notes/vendor/three/README' },
      ] },
    ],
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    returnToTopLabel: '返回顶部',
    sidebarMenuLabel: '文档目录',
    darkModeSwitchLabel: '切换外观',
    lightModeSwitchTitle: '切换为浅色模式',
    darkModeSwitchTitle: '切换为深色模式',
    notFound: { title: '页面不存在', quote: '可从项目概览继续阅读，或打开原型体验。', linkLabel: '返回首页', linkText: '返回首页' },
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          options: {
            tokenize(text) {
              return Array.from(new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text))
                .filter(segment => segment.isWordLike).map(segment => segment.segment);
            },
          },
        },
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                displayDetails: '显示详细结果', resetButtonTitle: '清除搜索', backButtonTitle: '关闭搜索',
                noResultsText: '未找到相关结果',
                footer: { selectText: '选择', selectKeyAriaLabel: '回车', navigateText: '切换', navigateUpKeyAriaLabel: '上方向键', navigateDownKeyAriaLabel: '下方向键', closeText: '关闭', closeKeyAriaLabel: 'Esc' },
              },
            },
          },
        },
      },
    },
  },
});
