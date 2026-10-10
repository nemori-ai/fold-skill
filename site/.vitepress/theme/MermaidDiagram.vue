<script lang="ts">
let diagramId = 0;
let renderQueue = Promise.resolve();
let library: Promise<typeof import('mermaid')> | undefined;

function renderDiagram(code: string, dark: boolean) {
  const result = renderQueue.then(async () => {
    const { default: mermaid } = await (library ??= import('mermaid'));
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'neutral',
      fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    });
    return mermaid.render(`fold-diagram-${++diagramId}`, code);
  });
  renderQueue = result.then(() => {}, () => {});
  return result;
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useData } from 'vitepress';

const props = defineProps<{ code: string }>();
const { isDark } = useData();
const svg = ref('');
const failed = ref(false);
let mounted = false;
let generation = 0;

async function render() {
  if (!mounted) return;
  const current = ++generation;
  failed.value = false;
  try {
    const output = await renderDiagram(props.code, isDark.value);
    if (mounted && current === generation) svg.value = output.svg;
  } catch {
    if (mounted && current === generation) { svg.value = ''; failed.value = true; }
  }
}

onMounted(() => { mounted = true; render(); });
watch([() => props.code, isDark], render);
onBeforeUnmount(() => { mounted = false; generation += 1; });
</script>

<template>
  <figure class="mermaid-diagram">
    <div v-if="svg" class="mermaid-diagram-image" v-html="svg" />
    <p v-else-if="failed" role="status">图表暂未渲染，可查看下面的原始定义。</p>
    <p v-else class="mermaid-diagram-status" role="status">正在绘制图表…</p>
    <details :open="!svg">
      <summary>查看图表定义</summary>
      <pre><code>{{ code }}</code></pre>
    </details>
  </figure>
</template>

<style scoped>
.mermaid-diagram { margin: 1.5rem 0; }
.mermaid-diagram-image { overflow-x: auto; padding: 1rem 0; }
.mermaid-diagram-image :deep(svg) { display: block; margin: auto; min-width: 30rem; max-width: 100%; height: auto; }
.mermaid-diagram summary { color: var(--vp-c-text-2); font-size: .8rem; cursor: pointer; }
.mermaid-diagram pre { max-height: 28rem; overflow: auto; padding: 1rem; background: var(--vp-code-block-bg); font-size: .75rem; line-height: 1.6; }
.mermaid-diagram-status { color: var(--vp-c-text-2); font-size: .875rem; }
</style>
