<script setup lang="ts">
import { computed } from 'vue'
import { Position, Handle, useVueFlow } from '@vue-flow/core'
import type { NodeProps } from '@vue-flow/core'

const props = defineProps<NodeProps>()

const x = computed(() => `${Math.round(props.position.x)}px`)
const y = computed(() => `${Math.round(props.position.y)}px`)
</script>

<template>
  <div class="vue-flow__node-default">
    <!-- <div>{{ props.data?.label }}</div> -->
    <div>{{ props.data?.node.constructor.name }}</div>

    <Handle v-if="props.type === 'voice'" type="source" :position="Position.Right" />
    <Handle v-else-if="props.type === 'space'" type="target" :position="Position.Left" />
    <template v-else>
      <Handle type="target" :position="Position.Left" />
      <Handle type="source" :position="Position.Right" />
    </template>
  </div>
</template>