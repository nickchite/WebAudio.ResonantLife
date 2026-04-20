<script setup lang="js">

import { onMounted, ref } from 'vue'
import Flow from './components/Flow.vue'
import { applyChanges, VueFlow, useVueFlow } from '@vue-flow/core'

import { Random, linexp } from "./lib.ts";
import { Output } from './nodes/misc.ts';
import { SineVoice, FormantVoice } from './nodes/voice.ts';
import { Space, DelaySpace, ReverbSpace, SpaceFactory } from './nodes/space.ts';
import { rand_type, rand_freq, random_formants } from './nodes/formant.ts';

import { VoiceFactory } from './nodes/voice.ts';

import * as Tone from "tone";

const flow = ref(null);

const CONTROL_RATE = 100;
const CONTROL_TIME = 1000 / CONTROL_RATE;

const sineCoherence = ref(0);
const formantCoherence = ref(0);

const DENSITY_MIN_BPM = 0;
const DENSITY_MAX_BPM = 300;
const DENSITY_FOCUS_BPM = 120;
const DENSITY_FOCUS_SLIDER = 0.72;
const DENSITY_HIGH_CURVE = 1.25;
const PITCH_COHERENCE_STEEPNESS = 12;
const HARMONIC_ROOT_FALLBACK_HZ = 55;
const HARMONIC_ROOT_MIN_HZ = 55;
const HARMONIC_ROOT_MAX_HZ = 110;
const HARMONIC_INDEX_POOL = [1, 2, 3, 4, 5, 6, 8];
const CONTROL_INPUT_SPEED_PER_SEC = 0.12;

const ROOT_MOTION_PROFILES = {
  lowVariance: {
    clockMinBpm: 3,
    clockMaxBpm: 24,
    densityExponent: 0.65,
    clockMinIntervalSec: 0.45,
    clockMaxIntervalSec: 16,
    shapeLo: 6,
    shapeHi: 18,
    harmonicitySteepness: 10,
    offSpreadSemisLow: 8,
    offSpreadSemisHigh: 0.25,
  },
  balanced: {
    clockMinBpm: 4,
    clockMaxBpm: 36,
    densityExponent: 0.72,
    clockMinIntervalSec: 0.35,
    clockMaxIntervalSec: 12,
    shapeLo: 4,
    shapeHi: 14,
    harmonicitySteepness: 9,
    offSpreadSemisLow: 12,
    offSpreadSemisHigh: 0.5,
  },
  highVariance: {
    clockMinBpm: 6,
    clockMaxBpm: 60,
    densityExponent: 0.85,
    clockMinIntervalSec: 0.25,
    clockMaxIntervalSec: 8,
    shapeLo: 2.5,
    shapeHi: 10,
    harmonicitySteepness: 7,
    offSpreadSemisLow: 14,
    offSpreadSemisHigh: 2,
  },
};

const ACTIVE_ROOT_MOTION_PROFILE = 'balanced';
const ROOT_MOTION = ROOT_MOTION_PROFILES[ACTIVE_ROOT_MOTION_PROFILE];

const activePad = ref(null);

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function sigmoid01(value, steepness = 8) {
  const x = clamp01(value);
  const s = Math.max(1e-6, steepness);
  const edgeLow = 1 / (1 + Math.exp(s / 2));
  const edgeHigh = 1 / (1 + Math.exp(-s / 2));
  const y = 1 / (1 + Math.exp(-s * (x - 0.5)));
  return clamp01((y - edgeLow) / (edgeHigh - edgeLow));
}

function densityFromBpm(bpm) {
  const b = Math.min(DENSITY_MAX_BPM, Math.max(DENSITY_MIN_BPM, bpm));

  if (b <= DENSITY_FOCUS_BPM) {
    const tLow = (b - DENSITY_MIN_BPM) / (DENSITY_FOCUS_BPM - DENSITY_MIN_BPM);
    return DENSITY_FOCUS_SLIDER * tLow;
  }

  const tHigh = (b - DENSITY_FOCUS_BPM) / (DENSITY_MAX_BPM - DENSITY_FOCUS_BPM);
  return DENSITY_FOCUS_SLIDER + (1 - DENSITY_FOCUS_SLIDER) * Math.pow(tHigh, 1 / DENSITY_HIGH_CURVE);
}

function bpmFromDensity(density) {
  const d = clamp01(density);

  if (d <= DENSITY_FOCUS_SLIDER) {
    const tLow = d / DENSITY_FOCUS_SLIDER;
    return lerp(DENSITY_MIN_BPM, DENSITY_FOCUS_BPM, tLow);
  }

  const tHigh = (d - DENSITY_FOCUS_SLIDER) / (1 - DENSITY_FOCUS_SLIDER);
  return lerp(DENSITY_FOCUS_BPM, DENSITY_MAX_BPM, Math.pow(tHigh, DENSITY_HIGH_CURVE));
}

const sineDensity = ref(densityFromBpm(DENSITY_MIN_BPM));
const formantDensity = ref(densityFromBpm(DENSITY_MIN_BPM));

const sineCoherenceActual = ref(sineCoherence.value);
const formantCoherenceActual = ref(formantCoherence.value);
const sineDensityActual = ref(sineDensity.value);
const formantDensityActual = ref(formantDensity.value);

const voices = ref([]);
const spaces = ref([]);
const suppressedEdgeAdds = new Set();

let ctx;
let output;
let updateInterval;
let harmonicRootHz = HARMONIC_ROOT_FALLBACK_HZ;
let nextRootChangeTime = 0;

function safeGainValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : value;
}

function inspectLevels(node) {
  if (!node) return {};
  return {
    type: node.constructor?.name,
    fanGain: safeGainValue(node.fanGain?.gain?.value),
    gain: safeGainValue(node.gain?.gain?.value),
    master: safeGainValue(node.master?.gain?.value),
    dry: safeGainValue(node.dryGain?.gain?.value),
    wet: safeGainValue(node.wetGain?.gain?.value),
    output: safeGainValue(node.outputGain?.gain?.value),
    eqLow: safeGainValue(node.eq?.low?.value),
    eqMid: safeGainValue(node.eq?.mid?.value),
    eqHigh: safeGainValue(node.eq?.high?.value),
    filterFreq: safeGainValue(node.filter?.frequency?.value),
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function moveToward(current, target, maxStep) {
  const delta = target - current;
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

function moveToward2D(currentX, currentY, targetX, targetY, maxStep) {
  const dx = targetX - currentX;
  const dy = targetY - currentY;
  const distance = Math.hypot(dx, dy);

  if (distance <= maxStep || distance === 0) {
    return [targetX, targetY];
  }

  const scale = maxStep / distance;
  return [currentX + dx * scale, currentY + dy * scale];
}

function coherenceStepSize(coherence, harmonicStep = 100, minStep = 0.25) {
  const c = Math.min(1, Math.max(0, coherence));
  const ratio = minStep / harmonicStep;
  return harmonicStep * Math.pow(ratio, 1 - c);
}

function quantizeToStep(freq, step) {
  if (step <= 0) return freq;
  return Math.max(step, Math.round(freq / step) * step);
}

function foldToRange(freq, min, max) {
  if (!(freq > 0)) return min;
  let f = freq;
  while (f < min) f *= 2;
  while (f > max) f /= 2;
  return f;
}

function estimatePitchCenterHz() {
  const freqs = voices.value
    .map(v => v?.base?.frequency)
    .filter(f => typeof f === 'number' && Number.isFinite(f) && f > 0);

  if (freqs.length === 0) return HARMONIC_ROOT_FALLBACK_HZ;

  const logMean = Math.exp(freqs.reduce((sum, f) => sum + Math.log(f), 0) / freqs.length);
  return foldToRange(logMean, HARMONIC_ROOT_MIN_HZ, HARMONIC_ROOT_MAX_HZ);
}

function globalDensityValue() {
  return clamp01((sineDensityActual.value + formantDensityActual.value) / 2);
}

function globalCoherenceValue() {
  return clamp01((sineCoherenceActual.value + formantCoherenceActual.value) / 2);
}

function setPadTarget(type, event) {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = clamp01((event.clientX - rect.left) / rect.width);
  const y = clamp01((event.clientY - rect.top) / rect.height);
  const density = 1 - y;

  if (type === 'sine') {
    sineCoherence.value = x;
    sineDensity.value = density;
    return;
  }

  formantCoherence.value = x;
  formantDensity.value = density;
}

function startPadDrag(type, event) {
  activePad.value = type;
  event.currentTarget.setPointerCapture(event.pointerId);
  setPadTarget(type, event);
}

function movePadDrag(type, event) {
  if (activePad.value !== type) return;
  setPadTarget(type, event);
}

function endPadDrag(event) {
  activePad.value = null;
  if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

function updateSmoothedControls() {
  const maxStep = CONTROL_INPUT_SPEED_PER_SEC * (CONTROL_TIME / 1000);
  const [nextSineC, nextSineD] = moveToward2D(
    sineCoherenceActual.value,
    sineDensityActual.value,
    sineCoherence.value,
    sineDensity.value,
    maxStep,
  );
  const [nextFormantC, nextFormantD] = moveToward2D(
    formantCoherenceActual.value,
    formantDensityActual.value,
    formantCoherence.value,
    formantDensity.value,
    maxStep,
  );

  sineCoherenceActual.value = nextSineC;
  sineDensityActual.value = nextSineD;
  formantCoherenceActual.value = nextFormantC;
  formantDensityActual.value = nextFormantD;
}

function rootClockBpmFromGlobalDensity(globalDensity) {
  if (globalDensity <= 0) return 0;
  const sourceBpm = bpmFromDensity(globalDensity);
  const normalized = clamp01(sourceBpm / DENSITY_MAX_BPM);
  const shaped = Math.pow(normalized, ROOT_MOTION.densityExponent);
  return lerp(ROOT_MOTION.clockMinBpm, ROOT_MOTION.clockMaxBpm, shaped);
}

function sampleRootIntervalSec(clockBpm, globalCoherence) {
  const shape = lerp(ROOT_MOTION.shapeLo, ROOT_MOTION.shapeHi, clamp01(globalCoherence));
  const sampled = Random.gamma_tempo(clockBpm, shape).sample();
  return Math.min(ROOT_MOTION.clockMaxIntervalSec, Math.max(ROOT_MOTION.clockMinIntervalSec, sampled));
}

function pickHarmonicRootJump(centerHz, globalCoherence) {
  const c = sigmoid01(globalCoherence, ROOT_MOTION.harmonicitySteepness);

  const harmonicIndex = HARMONIC_INDEX_POOL[Math.floor(Math.random() * HARMONIC_INDEX_POOL.length)];
  const harmonicCandidate = foldToRange(centerHz * harmonicIndex, HARMONIC_ROOT_MIN_HZ, HARMONIC_ROOT_MAX_HZ);

  const offSpreadSemis = lerp(ROOT_MOTION.offSpreadSemisLow, ROOT_MOTION.offSpreadSemisHigh, c);
  const offSemis = Random.uniform().linlin(0, 1, -offSpreadSemis, offSpreadSemis).sample();
  const offRatio = Math.pow(2, offSemis / 12);
  const inharmonicCandidate = foldToRange(centerHz * offRatio, HARMONIC_ROOT_MIN_HZ, HARMONIC_ROOT_MAX_HZ);

  const mixed = lerp(inharmonicCandidate, harmonicCandidate, c);
  return foldToRange(mixed, HARMONIC_ROOT_MIN_HZ, HARMONIC_ROOT_MAX_HZ);
}

function updateHarmonicRootScheduler() {
  if (!ctx) return;

  const now = ctx.currentTime;
  if (nextRootChangeTime === 0) nextRootChangeTime = now;
  if (now < nextRootChangeTime) return;

  const gDensity = globalDensityValue();
  const gCoherence = globalCoherenceValue();
  const clockBpm = rootClockBpmFromGlobalDensity(gDensity);

  if (clockBpm <= 0) {
    nextRootChangeTime = now + ROOT_MOTION.clockMaxIntervalSec;
    return;
  }

  const center = estimatePitchCenterHz();
  harmonicRootHz = pickHarmonicRootJump(center, gCoherence);
  nextRootChangeTime = now + sampleRootIntervalSec(clockBpm, gCoherence);
}

function ratioFromSemitoneSpread(maxSemitones) {
  const semis = Random.uniform().linlin(0, 1, -maxSemitones, maxSemitones).sample();
  return Math.pow(2, semis / 12);
}

function envelopeRatio(spread) {
  return Random.uniform().linexp(0, 1, 1 / spread, spread).sample();
}

function buildVoiceDelta(voice, voiceCoherence, isFormant, densityBpm) {
  const c = voiceCoherence;
  const cPitch = sigmoid01(c, PITCH_COHERENCE_STEEPNESS);
  const shapeMul = linexp(c, 0, 1, 0.3, 3.0);
  const jitterSpread = lerp(2.2, 1.03, c);
  const maxFreqSemis = lerp(7.0, 0.6, cPitch);
  const gainSpread = lerp(1.8, 1.1, c);
  const envSpread = isFormant
    ? lerp(3.0, 1.08, c)
    : lerp(1.7, 1.05, c);
  const quantizeStep = coherenceStepSize(cPitch, harmonicRootHz, 0.25);

  const baseTempo = densityBpm;
  const baseShape = 0.5;
  const shapeNow = Math.max(0.1, baseShape * shapeMul);
  const baseTime = Random.gamma_tempo(baseTempo, shapeNow).sample();
  const time = baseTime * Random.uniform().linexp(0, 1, 1 / jitterSpread, jitterSpread).sample();

  const rawFreq = voice.base.frequency * ratioFromSemitoneSpread(maxFreqSemis);
  const finalFreq = quantizeToStep(rawFreq, quantizeStep);

  const delta = {
    time,
    frequency: finalFreq / voice.base.frequency,
    gain: Random.uniform().linexp(0, 1, 1 / gainSpread, gainSpread).sample(),
    attack: envelopeRatio(envSpread),
    decay: envelopeRatio(envSpread),
    sustain: lerp(Random.uniform().linlin(0, 1, 0.4, 1.25).sample(), 1, c),
    release: envelopeRatio(envSpread),
  };

  if (isFormant) {
    const formantFreqSpread = lerp(2.8, 1.04, cPitch);
    const formantQSpread = lerp(2.2, 1.02, cPitch);
    return {
      ...delta,
      formantFrequency: Random.uniform().linexp(0, 1, 1 / formantFreqSpread, formantFreqSpread).sample(),
      formantQ: Random.uniform().linexp(0, 1, 1 / formantQSpread, formantQSpread).sample(),
    };
  }

  return delta;
}

const startAudio = async () => {
  ctx = Tone.context;

  output = new Output(ctx);
  
  updateInterval = setInterval(update, CONTROL_TIME);
}

const ensureAudioRunning = async () => {
  await Tone.start();
  if (ctx?.state !== 'running') {
    await ctx.resume();
  }
}

onMounted(async () => { startAudio(); });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearInterval(updateInterval);
    // Leave Tone's shared AudioContext open across HMR — closing it bricks
    // the context for the life of the page requiring a full browser reload.
    console.log('VITE Reload: interval cleared, audio context preserved');
  });
}


function update() {
  updateSmoothedControls();
  updateHarmonicRootScheduler();

  voices.value.forEach((voice) => {
    const isFormant = voice instanceof FormantVoice;
    const voiceCoherence = isFormant ? formantCoherenceActual.value : sineCoherenceActual.value;
    const voiceDensity = isFormant
      ? bpmFromDensity(formantDensityActual.value)
      : bpmFromDensity(sineDensityActual.value);

    if (voiceDensity <= 0) return;

    voice.update(buildVoiceDelta(voice, voiceCoherence, isFormant, voiceDensity));
  });
  spaces.value.forEach((space) => {
    space.update({ 
      time: Random.exponential(1/10).sample(),
    });
  });
}

async function addNode(type/*: 'voice' | 'space'*/) {
  await ensureAudioRunning();

  const idx = type === 'voice' ? voices.value.length : spaces.value.length;
  const id = `${type}-${idx}`;

  let node;
  if (type === 'voice') {
    node = VoiceFactory.createRandom(ctx);
    voices.value.push(node);
  } else if (type === 'space') {
    node = SpaceFactory.create(ctx).randomize();
    node.connect(output);
    const pan = pickPan(spaces.value.map(s => s.base.pannerPos));
    node.base.pannerPos = pan;
    node.panner.pan.value = pan;
    spaces.value.push(node);
  }

  flow.value.graph.set(id, node);

  const position = getSpawnPosition(type);
  flow.value.addNodes({
    id,
    type,
    position,
    data: {
      label: id,
      node: node,
    }
  });

  if (type === 'voice' && spaces.value.length > 0) {
    const targetIndex = Math.floor(Math.random() * spaces.value.length);
    const targetId = `space-${targetIndex}`;
    const edgeKey = `${id}->${targetId}`;

    await connect(id, targetId);
    suppressedEdgeAdds.add(edgeKey);
    flow.value.addEdges({
      id: edgeKey,
      source: id,
      target: targetId,
    });
  }
  
  console.log('added node', id, node);
}

function pickPan(existing, candidates = 32) {
  if (existing.length === 0) return (Math.random() * 2) - 1;
  let best = -1, bestScore = -Infinity;
  for (let i = 0; i < candidates; i++) {
    const candidate = (Math.random() * 2) - 1;
    const minDist = Math.min(...existing.map(p => Math.abs(candidate - p)));
    if (minDist > bestScore) { bestScore = minDist; best = candidate; }
  }
  return best;
}

function redistributePan(rampTime = 1.5) {
  const n = spaces.value.length;
  const now = ctx.currentTime;
  spaces.value.forEach((space, i) => {
    const pan = n === 1 ? 0 : -1 + (2 * i) / (n - 1);
    space.base.pannerPos = pan;
    space.panner.pan.linearRampToValueAtTime(pan, now + rampTime);
  });
}

function getSpawnPosition(type) {
  const width = window.innerWidth;
  const isVoice = type === 'voice';
  const minX = isVoice ? 60 : width * 0.6;
  const maxX = isVoice ? width * 0.35 : width - 180;

  return {
    x: minX + Math.random() * Math.max(40, maxX - minX),
    y: 50 + Math.random() * 500,
  }
}

async function connect(source, target) {
  await ensureAudioRunning();

  const edgeKey = `${source}->${target}`;
  if (suppressedEdgeAdds.has(edgeKey)) {
    suppressedEdgeAdds.delete(edgeKey);
    return
  }

  const src = flow.value.graph.get(source)
  const tgt = flow.value.graph.get(target)
  
  console.log(`connecting ${source} to ${target}`, src, tgt);

  if (!src || !tgt) return

  console.log(src, tgt, src.output(), tgt.input());
  console.table({
    source: inspectLevels(src),
    target: inspectLevels(tgt),
    output: inspectLevels(output),
  });

  try {
    src.connect(tgt)
  } catch (err) {
    console.error(err)
  }
}

function disconnect(source, target) {
  const src = flow.value.graph.get(source)
  const tgt = flow.value.graph.get(target)

  console.log(`disconnecting ${source} from ${target}`, src, tgt);

  if (!src || !tgt) return

  try {
    src.disconnect(tgt)
  } catch (err) {
    console.error(err)
  }
}
;
</script>

<template>
  <h1>Resonant Life</h1>
  <button id="resume" @click="ctx.resume()">ctx.resume</button>
  <button @click="addNode('voice')">add voice</button>
  <button @click="addNode('space')">add space</button>
  <input id='gain' @input="event => output.master.gain.exponentialRampToValueAtTime(event.target.value, ctx.currentTime + 0.010)"
    type="range" min="0.0001" max="1" step="0.0001" value="0.5"
  />
  <div class="xy-controls">
    <div class="xy-column">
      <strong>Sine XY</strong>
      <div
        class="xy-pad"
        @pointerdown="event => startPadDrag('sine', event)"
        @pointermove="event => movePadDrag('sine', event)"
        @pointerup="endPadDrag"
        @pointercancel="endPadDrag"
      >
        <div
          class="xy-dot xy-dot-target"
          :style="{
            left: (sineCoherence * 100) + '%',
            top: ((1 - sineDensity) * 100) + '%'
          }"
        ></div>
        <div
          class="xy-dot xy-dot-actual"
          :style="{
            left: (sineCoherenceActual * 100) + '%',
            top: ((1 - sineDensityActual) * 100) + '%'
          }"
        ></div>
        <div class="xy-axis xy-axis-x">coherence</div>
        <div class="xy-axis xy-axis-y">density</div>
      </div>
    </div>

    <div class="xy-column">
      <strong>Formant XY</strong>
      <div
        class="xy-pad"
        @pointerdown="event => startPadDrag('formant', event)"
        @pointermove="event => movePadDrag('formant', event)"
        @pointerup="endPadDrag"
        @pointercancel="endPadDrag"
      >
        <div
          class="xy-dot xy-dot-target"
          :style="{
            left: (formantCoherence * 100) + '%',
            top: ((1 - formantDensity) * 100) + '%'
          }"
        ></div>
        <div
          class="xy-dot xy-dot-actual"
          :style="{
            left: (formantCoherenceActual * 100) + '%',
            top: ((1 - formantDensityActual) * 100) + '%'
          }"
        ></div>
        <div class="xy-axis xy-axis-x">coherence</div>
        <div class="xy-axis xy-axis-y">density</div>
      </div>
    </div>
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

@media (max-width: 760px) {
  .xy-controls {
    grid-template-columns: 1fr;
  }
}
</style>
