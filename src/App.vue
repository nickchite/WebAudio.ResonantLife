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

const shape = ref(0.5);
const tempo = ref(120);

const voices = ref([]);
const spaces = ref([]);

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
    voice.update({ 
      time: Random.gamma_tempo(tempo.value, shape.value).sample(),
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
  
  console.log('added node', id, node);
}

function getSpawnPosition(type) {
  return {
    x: (type === 'voice' ? 100 : 200) + Math.random() * 200,
    y: 50 + Math.random() * 500,
  }
}

async function connect(source, target) {
  await ensureAudioRunning();

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
  <label for="tempo">tempo {{ tempo }}</label>
  <input id='tempo' @input="event => tempo = event.target.value"
    type="range" min="30" max="240" step="0.01" value="120"
  />
  <label for="scale">scale {{ shape }}</label>
  <input id='scale' @input="event => shape = linexp(event.target.value, 0, 1, 0.1, 1000)"
    type="range" min="0" max="1" step="0.0001" value="0.5"
  />
  <div id="flow" style="height: 75vh; width: 100vw;">
    <Flow
      ref="flow"
      @edge-add="connect"
      @edge-remove="disconnect"
    />
  </div>
</template>
