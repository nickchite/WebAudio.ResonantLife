<script setup lang="js">

import { onMounted, ref } from 'vue'
import Flow from './components/Flow.vue'
import XYPad from './components/XYPad.vue'
import { useResonantEngine } from './composables/useResonantEngine.js'

const flow = ref(null);

const XY_DOT_RADIUS_PX = 10;
const XY_ACTUAL_DOT_RADIUS_PX = 13;
const XY_SLEW_RATE = 0.12;

const {
  connect,
  disconnect,
  startAudio,
  disposeAudio,
  addNode,
  sine,
  formant,
} = useResonantEngine({
  flow,
});

onMounted(async () => {
  startAudio();
  const voice = addNode('voice', { type: 'formant', coherence: 0.5, density: 0.5 });
  const space = addNode('space', { coherence: 0.5, density: 0.5 });
  connect(voice, space);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeAudio();
  });
}
</script>

<template>
  <h1>Resonant Life</h1>
  <div class="xy-controls">
    <XYPad
      title="Sine XY"
      x-label="coherence"
      y-label="density"
      :initial-x="0.5"
      :initial-y="0.5"
      :dot-radius-px="XY_DOT_RADIUS_PX"
      :actual-dot-radius-px="XY_ACTUAL_DOT_RADIUS_PX"
      :slew-rate="XY_SLEW_RATE"
      @update:actualX="sine.setCoherence"
      @update:actualY="sine.setDensity"
    />
    <XYPad
      title="Formant XY"
      x-label="coherence"
      y-label="density"
      :initial-x="0.5"
      :initial-y="0.5"
      :dot-radius-px="XY_DOT_RADIUS_PX"
      :actual-dot-radius-px="XY_ACTUAL_DOT_RADIUS_PX"
      :slew-rate="XY_SLEW_RATE"
      @update:actualX="formant.setCoherence"
      @update:actualY="formant.setDensity"
    />
  </div>
  <div id="flow" style="height: 75vh; width: 100vw;">
    <Flow
      ref="flow"
      @edge-add="connect"
      @edge-remove="disconnect"
    />
  </div>
</template>

<style scoped>
.xy-controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(220px, 1fr));
  gap: 1.25rem;
  margin: 0.75rem 0 1rem;
}

@media (max-width: 760px) {
  .xy-controls {
    grid-template-columns: 1fr;
  }
}
</style>
