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
const ROOT_CLOCK_MIN_BPM = 6;
const ROOT_CLOCK_MAX_BPM = 72;
const ROOT_CLOCK_DENSITY_EXPONENT = 0.8;
const ROOT_CLOCK_MIN_INTERVAL_SEC = 0.35;
const ROOT_CLOCK_MAX_INTERVAL_SEC = 12;
const ROOT_CLOCK_SHAPE_LO = 2.5;
const ROOT_CLOCK_SHAPE_HI = 12;
const HARMONIC_INDEX_POOL = [1, 2, 3, 4, 5, 6, 8];
const ROOT_HARMONICITY_STEEPNESS = 8;

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
  return clamp01((sineDensity.value + formantDensity.value) / 2);
}

function globalCoherenceValue() {
  return clamp01((sineCoherence.value + formantCoherence.value) / 2);
}

function rootClockBpmFromGlobalDensity(globalDensity) {
  if (globalDensity <= 0) return 0;
  const sourceBpm = bpmFromDensity(globalDensity);
  const normalized = clamp01(sourceBpm / DENSITY_MAX_BPM);
  const shaped = Math.pow(normalized, ROOT_CLOCK_DENSITY_EXPONENT);
  return lerp(ROOT_CLOCK_MIN_BPM, ROOT_CLOCK_MAX_BPM, shaped);
}

function sampleRootIntervalSec(clockBpm, globalCoherence) {
  const shape = lerp(ROOT_CLOCK_SHAPE_LO, ROOT_CLOCK_SHAPE_HI, clamp01(globalCoherence));
  const sampled = Random.gamma_tempo(clockBpm, shape).sample();
  return Math.min(ROOT_CLOCK_MAX_INTERVAL_SEC, Math.max(ROOT_CLOCK_MIN_INTERVAL_SEC, sampled));
}

function pickHarmonicRootJump(centerHz, globalCoherence) {
  const c = sigmoid01(globalCoherence, ROOT_HARMONICITY_STEEPNESS);

  const harmonicIndex = HARMONIC_INDEX_POOL[Math.floor(Math.random() * HARMONIC_INDEX_POOL.length)];
  const harmonicCandidate = foldToRange(centerHz * harmonicIndex, HARMONIC_ROOT_MIN_HZ, HARMONIC_ROOT_MAX_HZ);

  const offSpreadSemis = lerp(9, 1.5, c);
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
    nextRootChangeTime = now + ROOT_CLOCK_MAX_INTERVAL_SEC;
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
  updateHarmonicRootScheduler();

  voices.value.forEach((voice) => {
    const isFormant = voice instanceof FormantVoice;
    const voiceCoherence = isFormant ? formantCoherence.value : sineCoherence.value;
    const voiceDensity = isFormant
      ? bpmFromDensity(formantDensity.value)
      : bpmFromDensity(sineDensity.value);

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
  <div class="voice-controls">
    <div class="voice-controls-column">
      <strong>Sine Coherence</strong>
      <label for="coherence-sine">{{ sineCoherence.toFixed(2) }}</label>
      <input id='coherence-sine' @input="event => sineCoherence = Number(event.target.value)"
        type="range" min="0" max="1" step="0.0001" :value="sineCoherence"
      />

      <strong>Sine Density</strong>
      <label for="density-sine">{{ bpmFromDensity(sineDensity).toFixed(1) }}</label>
      <input id='density-sine' @input="event => sineDensity = Number(event.target.value)"
        type="range" min="0" max="1" step="0.0001" :value="sineDensity"
      />
    </div>

    <div class="voice-controls-column">
      <strong>Formant Coherence</strong>
      <label for="coherence-formant">{{ formantCoherence.toFixed(2) }}</label>
      <input id='coherence-formant' @input="event => formantCoherence = Number(event.target.value)"
        type="range" min="0" max="1" step="0.0001" :value="formantCoherence"
      />

      <strong>Formant Density</strong>
      <label for="density-formant">{{ bpmFromDensity(formantDensity).toFixed(1) }}</label>
      <input id='density-formant' @input="event => formantDensity = Number(event.target.value)"
        type="range" min="0" max="1" step="0.0001" :value="formantDensity"
      />
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
.voice-controls {
  display: flex;
  justify-content: space-between;
  gap: 1.5rem;
  margin: 0.75rem 0;
}

.voice-controls-column {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  width: 50%;
}
</style>
