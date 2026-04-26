<script setup lang="ts">
import { Position, Handle } from '@vue-flow/core'
import type { NodeProps } from '@vue-flow/core'

const props = defineProps<NodeProps>()
</script>

<template>
  <div class="rl-node" :class="[props.type, props.data?.label?.toLowerCase()]">
    <span>{{ props.data?.label ?? props.type }}</span>
    <template v-if="props.type === 'voice'">
      <Handle id="source-top"    type="source" :position="Position.Top"    :style="{ left: `${48 + (props.data?.jitter?.sourceTop    ?? 0)}%` }" />
      <Handle id="source-right"  type="source" :position="Position.Right"  :style="{ top:  `${48 + (props.data?.jitter?.sourceRight  ?? 0)}%` }" />
      <Handle id="source-bottom" type="source" :position="Position.Bottom" :style="{ left: `${48 + (props.data?.jitter?.sourceBottom ?? 0)}%` }" />
      <Handle id="source-left"   type="source" :position="Position.Left"   :style="{ top:  `${48 + (props.data?.jitter?.sourceLeft   ?? 0)}%` }" />
    </template>
    <template v-else-if="props.type === 'space'">
      <Handle id="target-top"    type="target" :position="Position.Top"    :style="{ left: `${48 + (props.data?.jitter?.targetTop    ?? 0)}%` }" />
      <Handle id="target-right"  type="target" :position="Position.Right"  :style="{ top:  `${48 + (props.data?.jitter?.targetRight  ?? 0)}%` }" />
      <Handle id="target-bottom" type="target" :position="Position.Bottom" :style="{ left: `${48 + (props.data?.jitter?.targetBottom ?? 0)}%` }" />
      <Handle id="target-left"   type="target" :position="Position.Left"   :style="{ top:  `${48 + (props.data?.jitter?.targetLeft   ?? 0)}%` }" />
    </template>
  </div>
</template>

<style scoped>
.rl-node {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 62px;
  height: 36px;
  border-radius: 5px;
  border: 1.5px solid #6366f1;
  background: #1e1b4b;
  color: #c7d2fe;
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: default;
  user-select: none;
}

.rl-node.space {
  border-color: #a78bfa;
  background: #2e1065;
  color: #ddd6fe;
}

.rl-node.voice {
  border-color: #00d4ff;
  background: #001f2e;
  color: #7eeeff;
}

.rl-node.voice.formant {
  border-color: #f97316;
  background: #1f0a00;
  color: #fdba74;
}
</style>