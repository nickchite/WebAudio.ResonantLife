<script setup lang="js">

import { onMounted, ref } from 'vue'
import Flow from './components/Flow.vue'
import XYPad from './components/XYPad.vue'
import { useResonantEngine } from './composables/useResonantEngine.js'

const flow = ref(null);

const sineCoherence = ref(0.5);
const formantCoherence = ref(0.5);
const PAD_EDGE_INSET = 0.08;

const sineDensity = ref(0.5);
const formantDensity = ref(0.5);

const sineCoherenceActual = ref(sineCoherence.value);
const formantCoherenceActual = ref(formantCoherence.value);
const sineDensityActual = ref(sineDensity.value);
const formantDensityActual = ref(formantDensity.value);

function updateSineCoherence(value) { sineCoherence.value = value; }
function updateSineDensity(value) { sineDensity.value = value; }
function updateFormantCoherence(value) { formantCoherence.value = value; }
function updateFormantDensity(value) { formantDensity.value = value; }

const {
  connect,
  disconnect,
  startAudio,
  disposeAudio,
} = useResonantEngine({
  flow,
  sineCoherence,
  formantCoherence,
  sineDensity,
  formantDensity,
  sineCoherenceActual,
  formantCoherenceActual,
  sineDensityActual,
  formantDensityActual,
});

onMounted(async () => { startAudio(); });

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
      :coherence="sineCoherence"
      :density="sineDensity"
      :coherence-actual="sineCoherenceActual"
      :density-actual="sineDensityActual"
      :edge-inset="PAD_EDGE_INSET"
      @update:coherence="updateSineCoherence"
      @update:density="updateSineDensity"
    />
    <XYPad
      title="Formant XY"
      :coherence="formantCoherence"
      :density="formantDensity"
      :coherence-actual="formantCoherenceActual"
      :density-actual="formantDensityActual"
      :edge-inset="PAD_EDGE_INSET"
      @update:coherence="updateFormantCoherence"
      @update:density="updateFormantDensity"
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
