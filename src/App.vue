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

const DENSITY_MIN_BPM = 10;
const DENSITY_MAX_BPM = 300;

function densityFromBpm(bpm) {
  return Math.log(bpm / DENSITY_MIN_BPM) / Math.log(DENSITY_MAX_BPM / DENSITY_MIN_BPM);
}

function bpmFromDensity(density) {
  return linexp(density, 0, 1, DENSITY_MIN_BPM, DENSITY_MAX_BPM);
}

const sineDensity = ref(densityFromBpm(DENSITY_MIN_BPM));
const formantDensity = ref(densityFromBpm(DENSITY_MIN_BPM));

const voices = ref([]);
const spaces = ref([]);
const suppressedEdgeAdds = new Set();

let ctx;
let output;
let updateInterval;

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

function quantizeFrequencyDivision(freq, rootFreq = 110, divisions = 6) {
  const ratio = Math.max(1e-6, freq / rootFreq);
  const stepPosition = Math.log2(ratio) * divisions;
  const snapped = Math.round(stepPosition);
  return rootFreq * Math.pow(2, snapped / divisions);
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
  const shapeMul = linexp(c, 0, 1, 0.3, 3.0);
  const jitterSpread = lerp(2.2, 1.03, c);
  const maxFreqSemis = lerp(7.0, 0.6, c);
  const gainSpread = lerp(1.8, 1.1, c);
  const envSpread = isFormant
    ? lerp(3.0, 1.08, c)
    : lerp(1.7, 1.05, c);
  const quantizeMix = c;
  const divisions = Math.round(lerp(36, 6, c));

  const baseTempo = densityBpm;
  const baseShape = 0.5;
  const shapeNow = Math.max(0.1, baseShape * shapeMul);
  const baseTime = Random.gamma_tempo(baseTempo, shapeNow).sample();
  const time = baseTime * Random.uniform().linexp(0, 1, 1 / jitterSpread, jitterSpread).sample();

  const rawFreq = voice.base.frequency * ratioFromSemitoneSpread(maxFreqSemis);
  const quantized = quantizeFrequencyDivision(rawFreq, 110, divisions);
  const finalFreq = lerp(rawFreq, quantized, quantizeMix);

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
    const formantFreqSpread = lerp(2.8, 1.04, c);
    const formantQSpread = lerp(2.2, 1.02, c);
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
  voices.value.forEach((voice) => {
    const isFormant = voice instanceof FormantVoice;
    const voiceCoherence = isFormant ? formantCoherence.value : sineCoherence.value;
    const voiceDensity = isFormant
      ? bpmFromDensity(formantDensity.value)
      : bpmFromDensity(sineDensity.value);

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
