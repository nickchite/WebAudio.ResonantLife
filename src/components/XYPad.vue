<script setup lang="js">
import { ref } from 'vue'

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  coherence: {
    type: Number,
    required: true,
  },
  density: {
    type: Number,
    required: true,
  },
  coherenceActual: {
    type: Number,
    required: true,
  },
  densityActual: {
    type: Number,
    required: true,
  },
  edgeInset: {
    type: Number,
    default: 0.08,
  },
})

const emit = defineEmits(['update:coherence', 'update:density'])

const dragging = ref(false)
const activePointerId = ref(null)

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function safeInsetValue() {
  return Math.min(0.45, clamp01(props.edgeInset))
}

function axisPercent(value) {
  const inset = safeInsetValue()
  return (inset + clamp01(value) * (1 - 2 * inset)) * 100
}

function densityPercent(density) {
  return axisPercent(1 - clamp01(density))
}

function setTargetFromEvent(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  const safeInset = safeInsetValue()
  const usableWidth = Math.max(1e-6, rect.width * (1 - 2 * safeInset))
  const usableHeight = Math.max(1e-6, rect.height * (1 - 2 * safeInset))
  const x = clamp01((event.clientX - rect.left - rect.width * safeInset) / usableWidth)
  const y = clamp01((event.clientY - rect.top - rect.height * safeInset) / usableHeight)

  emit('update:coherence', x)
  emit('update:density', 1 - y)
}

function onPointerDown(event) {
  dragging.value = true
  activePointerId.value = event.pointerId
  event.currentTarget.setPointerCapture(event.pointerId)
  setTargetFromEvent(event)
}

function onPointerMove(event) {
  if (!dragging.value || event.pointerId !== activePointerId.value) return
  setTargetFromEvent(event)
}

function onPointerEnd(event) {
  if (event.pointerId !== activePointerId.value) return
  dragging.value = false
  activePointerId.value = null
  if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
}
</script>

<template>
  <div class="xy-column">
    <strong>{{ title }}</strong>
    <div
      class="xy-pad"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="onPointerEnd"
    >
      <div
        class="xy-dot xy-dot-target"
        :style="{
          left: axisPercent(coherence) + '%',
          top: densityPercent(density) + '%'
        }"
      ></div>
      <div
        class="xy-dot xy-dot-actual"
        :style="{
          left: axisPercent(coherenceActual) + '%',
          top: densityPercent(densityActual) + '%'
        }"
      ></div>
      <div class="xy-axis xy-axis-x">coherence</div>
      <div class="xy-axis xy-axis-y">density</div>
    </div>
  </div>
</template>

<style scoped>
.xy-column {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.xy-pad {
  position: relative;
  aspect-ratio: 1;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background:
    radial-gradient(circle at 20% 20%, rgba(255, 160, 110, 0.26), transparent 42%),
    radial-gradient(circle at 80% 80%, rgba(110, 210, 255, 0.22), transparent 45%),
    linear-gradient(145deg, #1b1f26, #101318);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.05),
    0 12px 26px rgba(0, 0, 0, 0.3);
  cursor: crosshair;
  touch-action: none;
}

.xy-pad::before,
.xy-pad::after {
  content: '';
  position: absolute;
  pointer-events: none;
  opacity: 0.22;
}

.xy-pad::before {
  left: 0;
  right: 0;
  top: 50%;
  border-top: 1px dashed rgba(255, 255, 255, 0.35);
}

.xy-pad::after {
  top: 0;
  bottom: 0;
  left: 50%;
  border-left: 1px dashed rgba(255, 255, 255, 0.35);
}

.xy-dot {
  position: absolute;
  border-radius: 999px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.xy-dot-target {
  width: 20px;
  height: 20px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow:
    0 0 0 3px rgba(255, 255, 255, 0.2),
    0 0 18px rgba(255, 255, 255, 0.42);
}

.xy-dot-actual {
  width: 26px;
  height: 26px;
  background: rgba(200, 215, 235, 0.35);
  border: 1px solid rgba(220, 230, 245, 0.45);
  box-shadow: 0 0 20px rgba(175, 200, 230, 0.28);
}

.xy-axis {
  position: absolute;
  color: rgba(255, 255, 255, 0.72);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.68rem;
  pointer-events: none;
}

.xy-axis-x {
  left: 50%;
  bottom: 0.45rem;
  transform: translateX(-50%);
}

.xy-axis-y {
  right: 0.45rem;
  top: 50%;
  transform: translateY(-50%);
  writing-mode: vertical-rl;
  text-orientation: mixed;
  letter-spacing: 0.14em;
}
</style>