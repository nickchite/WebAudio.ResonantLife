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
  addNode,
  startAudio,
  disposeAudio,
  sine,
  formant,
} = useResonantEngine({
  flow,
});

async function addSineVoice() {
  await addNode('voice', {
    weighted: true,
    weights: { sine: 1, formant: 0 },
    origin: 'button-sine',
  });
}

async function addFormantVoice() {
  await addNode('voice', {
    weighted: true,
    weights: { sine: 0, formant: 1 },
    origin: 'button-formant',
  });
}

onMounted(async () => {
  await startAudio();

  for (let i = 0; i < 4; i += 1) {
    await addNode('space', { origin: 'startup-space' });
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeAudio();
  });
}
</script>

<template>
  <h1>Resonant Life</h1>
  <div class="voice-controls">
    <button type="button" @click="addSineVoice">Add Sine Voice</button>
    <button type="button" @click="addFormantVoice">Add Formant Voice</button>
  </div>
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
.voice-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 0.5rem 0 0.85rem;
}

.voice-controls button {
  border: 1px solid #d1d5db;
  background: #f8fafc;
  color: #0f172a;
  border-radius: 999px;
  padding: 0.45rem 0.85rem;
  font-size: 0.92rem;
  cursor: pointer;
}

.voice-controls button:hover {
  background: #eef2ff;
}

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
