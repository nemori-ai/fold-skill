<script setup>
const documents = [
  { href: '/overview', title: '项目概览', description: '从整体流程、设计状态与阅读顺序开始。' },
  { href: '/docs/product', title: '产品方向', description: '为什么需要整理，什么值得持续关注。' },
  { href: '/docs/user-stories', title: '用户故事', description: '放进具体情境，理解人的使用过程。' },
  { href: '/docs/information-contract', title: '信息契约', description: '查阅输入输出、份额、操作与反馈的精确规则。' },
]

const prototypes = [
  {
    id: 'a',
    name: '空间排布',
    description: '先看此刻。用事项面积表达关注份额，辨认重点与尚未分配的余量。',
    previewAlt: '空间排布原型的真实界面：不同面积的事项排列在画布中，底部保留回放时间轴。',
  },
  {
    id: 'b',
    name: '时间展开',
    description: '沿时间回看。把历史轨迹与当前份额并排，追踪变化与明确的合并关系。',
    previewAlt: '时间展开原型的真实界面：左侧历史轨迹连接当前份额截面，右侧呈现阅读区。',
  },
  {
    id: 'c',
    name: '流动形态',
    description: '通过液滴形变感知关注的变化。体量辅助比较，预算带保留准确数值。',
    previewAlt: '流动形态原型的真实界面：不同颜色与体量的液滴承载事项，下方显示准确的预算份额。',
  },
  {
    id: 'd',
    name: '手机首页',
    frame: 24,
    description: '打开手机的第一眼。卡片高度表达份额，按钮形态表达需要你做什么，可以就地回应。',
    previewAlt: '手机首页原型的真实界面：手机屏幕上按份额排列卡片，最重要的卡片带两个决定按钮，下方是预填金额的输入卡片。',
  },
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
      <div class="fold-gallery-heading">
        <div>
          <h2 id="fold-prototypes-title">同一份状态，四种表达</h2>
          <p>同一时刻的真实界面预览</p>
        </div>
        <nav class="fold-gallery-nav" aria-label="定位原型预览">
          <a v-for="prototype in prototypes" :key="prototype.id" :href="`#preview-${prototype.id}`">
            <span>{{ prototype.id.toUpperCase() }}</span>{{ prototype.name }}<span aria-hidden="true">↓</span>
          </a>
        </nav>
      </div>

      <ul class="fold-prototype-gallery">
        <li v-for="prototype in prototypes" :id="`preview-${prototype.id}`" :key="prototype.id">
          <a class="fold-preview-link" :href="`/prototype/?variant=${prototype.id}&frame=${prototype.frame ?? 9}`" target="_self">
            <div class="fold-preview-heading">
              <div class="fold-preview-title">
                <span class="fold-prototype-letter">{{ prototype.id.toUpperCase() }}</span>
                <h3>{{ prototype.name }}</h3>
              </div>
              <p>{{ prototype.description }}</p>
              <span class="fold-preview-action">体验此视图<span aria-hidden="true">→</span></span>
            </div>
            <img
              class="fold-preview-image"
              :src="`/previews/${prototype.id}.jpg`"
              :alt="prototype.previewAlt"
              width="1280"
              height="720"
              :loading="prototype.id === 'a' ? 'eager' : 'lazy'"
              :fetchpriority="prototype.id === 'a' ? 'high' : 'auto'"
              decoding="async"
            >
          </a>
        </li>
      </ul>

      <p class="fold-demo-note">点击预览进入对应时刻，可播放、回退或从头查看 37 个时间节点。四版共用同一份故事与状态。人物、私人消息与情境均为演示创作，Agent 判断已编排，未接入真实账户或运行中的 Agent。</p>
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
