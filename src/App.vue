<script setup lang="js">

import { onMounted, ref } from 'vue'
import Flow from './components/Flow.vue'
import XYPad from './components/XYPad.vue'
import { useResonantEngine } from './composables/useResonantEngine.js'

const flow = ref(null);
const started = ref(false);

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

onMounted(async () => {
  // nothing — boot requires user gesture
});

async function boot() {
  if (started.value) return;
  started.value = true;

  await startAudio();

  // 4 spaces in a loose quad, visually flipped front/rear:
  // front-left, rear-left, rear-right, front-right
  const W = window.innerWidth;
  const H = window.innerHeight * 0.68;
  const quadSpaces = [
    { pan: -0.85, position: { x: W * 0.24, y: H * 0.62 } },
    { pan: -0.35, position: { x: W * 0.24, y: H * 0.24 } },
    { pan:  0.35, position: { x: W * 0.66, y: H * 0.24 } },
    { pan:  0.85, position: { x: W * 0.66, y: H * 0.62 } },
  ];
  for (const s of quadSpaces) {
    await addNode('space', { pan: s.pan, position: s.position, origin: 'startup-space' });
  }

  await addNode('voice', { weighted: true, weights: { sine: 1, formant: 0 }, origin: 'startup-sine' });
  await addNode('voice', { weighted: true, weights: { sine: 0, formant: 1 }, origin: 'startup-formant' });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeAudio();
  });
}
</script>

<template>
  <h1>Resonant Life</h1>
  <div class="title-byline">Nick Chite</div>
  <div class="start-corner">
    <button v-if="!started" type="button" class="start-btn" @click="boot">Start</button>
  </div>
  <div id="flow" class="flow-stage">
    <Flow
      ref="flow"
      @edge-add="connect"
      @edge-remove="disconnect"
    />
  </div>
  <div class="xy-controls">
    <XYPad
      title="Sine"
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
      title="Formant"
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
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  height: 100%;
  overflow: hidden;
}

:global(body) {
  background:
    radial-gradient(1300px 720px at 14% 18%, rgba(167, 139, 250, 0.3), transparent 62%),
    radial-gradient(1100px 700px at 86% 20%, rgba(249, 115, 22, 0.27), transparent 60%),
    radial-gradient(1200px 760px at 12% 88%, rgba(239, 68, 68, 0.25), transparent 64%),
    radial-gradient(1200px 760px at 84% 88%, rgba(0, 212, 255, 0.25), transparent 64%),
    linear-gradient(180deg, #f8fafc 0%, #e8edf5 100%);
}

h1 {
  position: fixed;
  top: 1.2rem;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  z-index: 25;
  pointer-events: none;
}

.title-byline {
  position: fixed;
  top: 3.55rem;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  z-index: 25;
  pointer-events: none;
  font-size: 0.95rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(35, 39, 52, 0.72);
  font-weight: 500;
}

.xy-controls {
  display: flex;
  justify-content: center;
  gap: 1.2rem;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0;
  padding: 0.55rem 0.8rem 0.85rem;
  flex-wrap: wrap;
  z-index: 30;
  background: transparent;
}

.xy-controls :deep(.xy-column) {
  width: min(46vw, 320px);
}

.flow-stage {
  position: fixed;
  left: 0;
  right: 0;
  top: 3.5rem;
  bottom: clamp(15rem, 34vh, 22rem);
  background: transparent;
}

.flow-stage :deep(.vue-flow),
.flow-stage :deep(.vue-flow__container),
.flow-stage :deep(.vue-flow__pane),
.flow-stage :deep(.vue-flow__viewport) {
  background: transparent !important;
}

@media (max-width: 760px) {
  .xy-controls {
    justify-content: center;
    gap: 0.75rem;
    padding: 0.4rem 0.45rem 0.7rem;
  }

  .xy-controls :deep(.xy-column) {
    width: min(47vw, 270px);
  }

  .flow-stage {
    top: 3.15rem;
    bottom: clamp(11rem, 30vh, 15rem);
  }
}

.start-corner {
  position: fixed;
  top: 0.9rem;
  right: 0.9rem;
  z-index: 40;
}

.start-btn {
  font-size: 1.1rem;
  padding: 0.65rem 2.2rem;
  border-radius: 999px;
  border: 1px solid #6366f1;
  background: #6366f1;
  color: #fff;
  cursor: pointer;
  letter-spacing: 0.04em;
}

.start-btn:hover {
  background: #4f46e5;
  border-color: #4f46e5;
}
</style>
