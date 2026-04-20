<script setup lang="js">
import { onBeforeUnmount, ref, watch } from 'vue'
import { clamp } from '../lib.ts'

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  x: {
    type: Number,
    required: true,
  },
  y: {
    type: Number,
    required: true,
  },
  actualX: {
    type: Number,
    default: null,
  },
  actualY: {
    type: Number,
    default: null,
  },
  edgeInset: {
    type: Number,
    default: 0,
  },
  dotRadiusPx: {
    type: Number,
    default: 10,
  },
  actualDotRadiusPx: {
    type: Number,
    default: 10,
  },
  boundaryRadiusPx: {
    type: Number,
    default: null,
  },
  cornerRadiusPx: {
    type: Number,
    default: null,
  },
  xLabel: {
    type: String,
    default: 'x',
  },
  yLabel: {
    type: String,
    default: 'y',
  },
  xToUnit: {
    type: Function,
    default: (value) => value,
  },
  yToUnit: {
    type: Function,
    default: (value) => value,
  },
  unitToX: {
    type: Function,
    default: (value) => value,
  },
  unitToY: {
    type: Function,
    default: (value) => value,
  },
  slewRate: {
    type: Number,
    default: 0,
  },
})

const emit = defineEmits(['update:x', 'update:y', 'update:actualX', 'update:actualY'])

const dragging = ref(false)
const activePointerId = ref(null)
const internalActualXUnit = ref(0)
const internalActualYUnit = ref(0)

const AXIS_X = 'x'
const AXIS_Y = 'y'

let animationFrameId = null
let lastFrameMs = 0

function insetRatio() {
  return clamp(Number(props.edgeInset), 0, 0.45)
}

function targetDotRadiusPx() {
  return Math.max(0, Number(props.dotRadiusPx) || 0)
}

function actualDotRadiusPx() {
  return Math.max(0, Number(props.actualDotRadiusPx) || 0)
}

function displayBoundaryRadiusPx() {
  if (props.boundaryRadiusPx !== null) {
    return Math.max(0, Number(props.boundaryRadiusPx) || 0)
  }
  return Math.max(targetDotRadiusPx(), actualDotRadiusPx())
}

function padCornerRadiusPx() {
  if (props.cornerRadiusPx !== null) {
    return Math.max(0, Number(props.cornerRadiusPx) || 0)
  }
  return displayBoundaryRadiusPx()
}

function insetPxForRect(rect) {
  const ratioInset = Math.min(rect.width, rect.height) * insetRatio()
  const radiusInset = displayBoundaryRadiusPx()
  const rawInset = Math.max(ratioInset, radiusInset)
  const maxInset = Math.max(0, Math.min(rect.width, rect.height) / 2 - 1e-6)
  return clamp(rawInset, 0, maxInset)
}

function hasExternalActual() {
  return props.actualX !== null && props.actualY !== null
}

function axisToUnit(axis, value) {
  const toUnit = axis === AXIS_X ? props.xToUnit : props.yToUnit
  return clamp(toUnit(value), 0, 1)
}

function unitToAxisValue(axis, unit) {
  const fromUnit = axis === AXIS_X ? props.unitToX : props.unitToY
  return fromUnit(unit)
}

function moveToward2D(currentX, currentY, targetX, targetY, maxStep) {
  const dx = targetX - currentX
  const dy = targetY - currentY
  const distance = Math.hypot(dx, dy)

  if (distance <= maxStep || distance === 0) {
    return [targetX, targetY]
  }

  const scale = maxStep / distance
  return [currentX + dx * scale, currentY + dy * scale]
}

function cancelSlewAnimation() {
  if (animationFrameId === null) return
  cancelAnimationFrame(animationFrameId)
  animationFrameId = null
}

function emitInternalActual() {
  emit('update:actualX', unitToAxisValue(AXIS_X, internalActualXUnit.value))
  emit('update:actualY', unitToAxisValue(AXIS_Y, internalActualYUnit.value))
}

function runSlewFrame(timestampMs) {
  if (hasExternalActual()) {
    cancelSlewAnimation()
    return
  }

  const dtSec = lastFrameMs > 0 ? Math.max(0, (timestampMs - lastFrameMs) / 1000) : 0
  lastFrameMs = timestampMs

  const targetXUnit = axisToUnit(AXIS_X, props.x)
  const targetYUnit = axisToUnit(AXIS_Y, props.y)

  if (props.slewRate <= 0) {
    internalActualXUnit.value = targetXUnit
    internalActualYUnit.value = targetYUnit
    emitInternalActual()
    cancelSlewAnimation()
    return
  }

  const maxStep = props.slewRate * dtSec
  const [nextXUnit, nextYUnit] = moveToward2D(
    internalActualXUnit.value,
    internalActualYUnit.value,
    targetXUnit,
    targetYUnit,
    maxStep,
  )

  internalActualXUnit.value = nextXUnit
  internalActualYUnit.value = nextYUnit
  emitInternalActual()

  if (nextXUnit === targetXUnit && nextYUnit === targetYUnit) {
    cancelSlewAnimation()
    return
  }

  animationFrameId = requestAnimationFrame(runSlewFrame)
}

function startSlewAnimation() {
  if (hasExternalActual()) {
    cancelSlewAnimation()
    return
  }

  lastFrameMs = 0
  if (animationFrameId === null) {
    animationFrameId = requestAnimationFrame(runSlewFrame)
  }
}

function targetPercent(axis) {
  const value = axis === AXIS_X ? props.x : props.y
  return axisCssPosition(axis, axisToUnit(axis, value))
}

function actualPercent(axis) {
  if (hasExternalActual()) {
    const value = axis === AXIS_X ? props.actualX : props.actualY
    return axisCssPosition(axis, axisToUnit(axis, value))
  }

  const unit = axis === AXIS_X ? internalActualXUnit.value : internalActualYUnit.value
  return axisCssPosition(axis, unit)
}

function axisCssPosition(axis, unit) {
  const radius = displayBoundaryRadiusPx()
  const clampedUnit = clamp(unit, 0, 1)
  const uiUnit = axis === AXIS_X ? clampedUnit : 1 - clampedUnit
  return `calc(${radius}px + ${uiUnit} * (100% - ${radius * 2}px))`
}

function syncInternalActualFromTarget() {
  if (hasExternalActual()) return
  internalActualXUnit.value = axisToUnit(AXIS_X, props.x)
  internalActualYUnit.value = axisToUnit(AXIS_Y, props.y)
  emitInternalActual()
}

function setTargetFromEvent(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  const insetPx = insetPxForRect(rect)
  const usableWidth = Math.max(1e-6, rect.width - insetPx * 2)
  const usableHeight = Math.max(1e-6, rect.height - insetPx * 2)
  const xUnit = clamp((event.clientX - rect.left - insetPx) / usableWidth, 0, 1)
  const yTopUnit = clamp((event.clientY - rect.top - insetPx) / usableHeight, 0, 1)
  const yUnit = 1 - yTopUnit

  emit('update:x', unitToAxisValue(AXIS_X, xUnit))
  emit('update:y', unitToAxisValue(AXIS_Y, yUnit))
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

watch(
  () => [props.x, props.y, props.slewRate, props.xToUnit, props.yToUnit, props.unitToX, props.unitToY],
  () => {
    if (hasExternalActual()) return
    startSlewAnimation()
  },
  { immediate: true },
)

watch(
  () => [props.actualX, props.actualY],
  () => {
    if (hasExternalActual()) {
      cancelSlewAnimation()
      return
    }
    syncInternalActualFromTarget()
    startSlewAnimation()
  },
)

onBeforeUnmount(() => {
  cancelSlewAnimation()
})
</script>

<template>
  <div class="xy-column">
    <strong>{{ title }}</strong>
    <div
      class="xy-pad"
      :style="{ borderRadius: padCornerRadiusPx() + 'px' }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="onPointerEnd"
    >
      <div
        class="xy-dot xy-dot-target"
        :style="{
          left: targetPercent(AXIS_X),
          top: targetPercent(AXIS_Y),
          width: (targetDotRadiusPx() * 2) + 'px',
          height: (targetDotRadiusPx() * 2) + 'px'
        }"
      ></div>
      <div
        class="xy-dot xy-dot-actual"
        :style="{
          left: actualPercent(AXIS_X),
          top: actualPercent(AXIS_Y),
          width: (actualDotRadiusPx() * 2) + 'px',
          height: (actualDotRadiusPx() * 2) + 'px'
        }"
      ></div>
      <div class="xy-axis xy-axis-x">{{ xLabel }}</div>
      <div class="xy-axis xy-axis-y">{{ yLabel }}</div>
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
  background: rgba(255, 255, 255, 0.96);
  box-shadow:
    0 0 0 3px rgba(255, 255, 255, 0.2),
    0 0 18px rgba(255, 255, 255, 0.42);
}

.xy-dot-actual {
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