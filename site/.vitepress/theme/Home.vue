<script setup>
import PrototypeGallery from './PrototypeGallery.vue'
import { combinedPage, datasetNotice, prototypes } from './prototypes.mjs'

const documents = [
  { href: '/overview', title: '项目概览', description: '从整体流程、设计状态与阅读顺序开始。' },
  { href: '/docs/product', title: '产品方向', description: '为什么需要整理，什么值得持续关注。' },
  { href: '/docs/user-stories', title: '用户故事', description: '放进具体情境，理解人的使用过程。' },
  { href: '/docs/information-contract', title: '信息契约', description: '查阅输入输出、份额、操作与反馈的精确规则。' },
]
</script>

<template>
  <div class="fold-home">
    <header class="fold-intro">
      <div class="fold-intro-heading">
        <h1>Fold 文档与原型</h1>
        <a class="fold-read-link" href="#fold-documents-title">阅读文档<span aria-hidden="true">↓</span></a>
      </div>
      <p class="fold-intro-copy">让 Agent 整理多渠道信息，以有限的注意力份额，维护值得持续关注的状态。</p>
      <p class="fold-stage"><span>当前阶段</span>设计基线已完成，交互原型可体验；产品 CLI 与可安装 skill 尚未实现。</p>
    </header>

    <section class="fold-prototypes" aria-labelledby="fold-prototypes-title">
      <div class="fold-prototypes-heading">
        <div>
          <h2 id="fold-prototypes-title">同一份回放，{{ prototypes.length }} 个原型</h2>
          <p>每张图是该原型在默认时刻的真实界面；点开在本页弹框里试用，可以逐帧回放、悬停查看、就地回应。</p>
        </div>
        <a class="fold-read-link" :href="combinedPage" target="_self">合页（全部形式一页）<span aria-hidden="true">↗</span></a>
      </div>

      <PrototypeGallery size="large" />

      <p class="fold-demo-note">{{ datasetNotice }}这些形式都没有选定，未接入真实账户或运行中的 Agent。</p>
    </section>

    <section class="fold-documents" aria-labelledby="fold-documents-title">
      <div class="fold-documents-heading">
        <h2 id="fold-documents-title">阅读文档</h2>
        <p class="fold-section-intro">从使用情境读到精确规则。</p>
      </div>
      <ul class="fold-document-list">
        <li v-for="document in documents" :key="document.href">
          <a :href="document.href">
            <span class="fold-document-name">{{ document.title }}<span aria-hidden="true">→</span></span>
            <span class="fold-document-description">{{ document.description }}</span>
          </a>
        </li>
      </ul>
    </section>
  </div>
</template>
