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

const sineShape = ref(0.5);
const sineTempo = ref(120);
const formantShape = ref(0.5);
const formantTempo = ref(120);

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
    const voiceTempo = isFormant ? formantTempo.value : sineTempo.value;
    const voiceShape = isFormant ? formantShape.value : sineShape.value;

    voice.update({
      time: Random.gamma_tempo(voiceTempo, voiceShape).sample(),
      frequency: Random.normal().clamp(-5, 5).linexp(-5, 5, 0.8, 1 / 0.8).sample(),
      gain: Random.normal().clamp(-5, 5).linexp(-5, 5, 0.8, 1 / 0.8).sample(),
    });
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
      <strong>Sine</strong>
      <label for="tempo-sine">tempo {{ sineTempo }}</label>
      <input id='tempo-sine' @input="event => sineTempo = Number(event.target.value)"
        type="range" min="30" max="240" step="0.01" :value="sineTempo"
      />
      <label for="scale-sine">scale {{ sineShape }}</label>
      <input id='scale-sine' @input="event => sineShape = linexp(Number(event.target.value), 0, 1, 0.1, 1000)"
        type="range" min="0" max="1" step="0.0001" value="0.5"
      />
    </div>

    <div class="voice-controls-column">
      <strong>Formant</strong>
      <label for="tempo-formant">tempo {{ formantTempo }}</label>
      <input id='tempo-formant' @input="event => formantTempo = Number(event.target.value)"
        type="range" min="30" max="240" step="0.01" :value="formantTempo"
      />
      <label for="scale-formant">scale {{ formantShape }}</label>
      <input id='scale-formant' @input="event => formantShape = linexp(Number(event.target.value), 0, 1, 0.1, 1000)"
        type="range" min="0" max="1" step="0.0001" value="0.5"
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
