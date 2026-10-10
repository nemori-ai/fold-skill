<script setup>
const documents = [
  { href: '/overview', title: '项目概览', description: '从整体流程、设计状态与阅读顺序开始。' },
  { href: '/docs/product', title: '产品方向', description: '为什么需要整理，什么值得持续关注。' },
  { href: '/docs/user-stories', title: '用户故事', description: '放进具体情境，理解人的使用过程。' },
  { href: '/docs/information-contract', title: '信息契约', description: '查阅输入输出、份额、操作与反馈的精确规则。' },
]

const prototypes = [
  { id: 'a', name: '空间排布', description: '先看此刻。事项松散排布，面积表达关注份额。' },
  { id: 'b', name: '时间展开', description: '沿时间回看。追踪事项的份额变化与明确合并。' },
  { id: 'c', name: '流动形态', description: '通过液滴形变感知变化，预算带保留准确数值。' },
]
</script>

<template>
  <div class="fold-home">
    <header class="fold-intro">
      <h1>Fold 文档与原型</h1>
      <p class="fold-intro-copy">把多渠道信息整理成一份可持续更新的状态，用有限的注意力份额，表达哪些事情值得继续关注。</p>
      <nav class="fold-intro-links" aria-label="首页入口">
        <a href="#fold-documents-title">阅读文档<span aria-hidden="true">↓</span></a>
        <a href="#fold-prototypes-title">体验原型<span aria-hidden="true">↓</span></a>
      </nav>
      <p class="fold-stage"><span>当前阶段</span>设计基线已完成，交互原型可体验；产品 CLI 与可安装 skill 尚未实现。</p>
    </header>

    <div class="fold-entry-columns">
      <section class="fold-documents" aria-labelledby="fold-documents-title">
        <h2 id="fold-documents-title">阅读文档</h2>
        <p class="fold-section-intro">从使用情境读到精确规则。</p>
        <ul class="fold-document-list">
          <li v-for="document in documents" :key="document.href">
            <a :href="document.href">
              <span class="fold-document-name">{{ document.title }}<span aria-hidden="true">→</span></span>
              <span class="fold-document-description">{{ document.description }}</span>
            </a>
          </li>
        </ul>
      </section>

      <section class="fold-prototypes" aria-labelledby="fold-prototypes-title">
        <div class="fold-prototype-heading">
          <h2 id="fold-prototypes-title">交互原型</h2>
          <span>同一份状态，三种表达</span>
        </div>
        <p class="fold-section-intro">从空白开始，回放 37 个时间节点，查看输入、整理判断和结果。三版共用同一份故事与状态。</p>
        <ul class="fold-prototype-list">
          <li v-for="prototype in prototypes" :key="prototype.id">
            <a :href="`/prototype/?variant=${prototype.id}&frame=0`" target="_self">
              <span class="fold-prototype-letter" aria-hidden="true">{{ prototype.id.toUpperCase() }}</span>
              <span class="fold-prototype-content">
                <span class="fold-prototype-name">{{ prototype.name }}</span>
                <span class="fold-prototype-description">{{ prototype.description }}</span>
              </span>
              <span class="fold-prototype-action">开始回放<span aria-hidden="true">→</span></span>
            </a>
          </li>
        </ul>
        <p class="fold-demo-note">人物、私人消息与情境均为演示创作，Agent 判断已编排。原型未接入真实账户或运行中的 Agent。</p>
      </section>
    </div>
  </div>
</template>
