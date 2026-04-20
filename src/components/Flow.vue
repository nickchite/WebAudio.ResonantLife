<script setup lang="ts">
// import type { Node as FlowNode, Edge, NodeChange, EdgeChange } from '@vue-flow/core'
import { VueFlow, useVueFlow, type EdgeChange } from '@vue-flow/core'
import DSPNode from './Node.vue'
import DSPEdge from './Edge.vue'
import { ref } from 'vue'

const graph = new Map();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    nodes.value = [];
    edges.value = [];
  });
}
const {
  nodesDraggable,
  nodesConnectable,
  elementsSelectable,
  zoomOnScroll,
  zoomOnDoubleClick,
  zoomOnPinch,
  panOnScroll,
  panOnScrollMode,
  panOnDrag,
  onConnect,
  onNodeDragStop,
  onPaneClick,
  onPaneScroll,
  onPaneContextMenu,
  onNodeDragStart,
  onMoveEnd,
  addNodes,
  addEdges,
  removeNodes,
  removeEdges,
} = useVueFlow()

defineExpose({
  addNodes,
  addEdges,
  removeNodes,
  removeEdges,
  graph
});

nodesDraggable.value = true
nodesConnectable.value = true
elementsSelectable.value = true
zoomOnScroll.value = false
zoomOnDoubleClick.value = false
zoomOnPinch.value = false
panOnScroll.value = false
// panOnScrollMode.value = 'free'
panOnDrag.value = false

onConnect(addEdges);

function onEdgeChange(changes: EdgeChange[]) {
  changes.forEach(change => {
    if (change.type === 'add') {
      emit('edge-add', change.item.source, change.item.target);
    } else if (change.type === 'select') {
      emit('edge-select', change.source, change.target);
    } else if (change.type === 'remove') {
      emit('edge-remove', change.source, change.target);
    }
  });
}

const nodes = ref([]);
const edges = ref([]);

const emit = defineEmits(['edge-add', 'edge-select', 'edge-remove'])
</script>

<template>
  <VueFlow
    :nodes="nodes"
    :edges="edges"
    @edges-change="onEdgeChange"
  >
    <template #node-voice="voiceNodeProps">
      <DSPNode v-bind="voiceNodeProps" />
    </template>

    <template #node-space="spaceNodeProps">
      <DSPNode v-bind="spaceNodeProps" />
    </template>

    <template #edge-special="specialEdgeProps">
      <DSPEdge v-bind="specialEdgeProps" />
    </template>
  </VueFlow>
</template>

<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
</style>