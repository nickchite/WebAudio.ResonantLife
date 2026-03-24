<script setup lang="js">

import { ref } from 'vue'
import { Random, linexp } from "./lib.ts";
import { Output } from './nodes/misc.ts';
import { Voice, FormantVoice } from './nodes/voice.ts';
import { Space } from './nodes/space.ts';
import Flow from './components/Flow.vue'
import { applyChanges, VueFlow, useVueFlow } from '@vue-flow/core'


const flow = ref(null);

const CONTROL_RATE = 100;
const CONTROL_TIME = 1000 / CONTROL_RATE;

const context = new AudioContext();
const output = new Output(context);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (context && context.state !== 'closed') {
      context.close();
      console.log('Audio Context Closed');
    }
  });
}

function randFreq() { return Random.linexp(0, 1, 60, 1000); }
function randFormant() { return Random.linexp(0, 1, 200, 860); }
function randGain() { return Random.linexp(0, 1, 0.06, 1); }
function randDT() { return Random.linexp(0, 1, 0.25, 2); }

function update() {
  voices.forEach((voice) => {
    voice.update({ 
      time: Random.exponential(1/3),
      freq: Random.normal(1, 0.02),
      gain: Random.normal(1, 0.1),
    });
  });
  spaces.forEach((space) => {
    space.update({ 
      time: Random.exponential(1/10),
      dt: Random.normal(1, 0.02),
      fb: Math.min(Random.normal(1, 0.1), 0.95 / space.base.fb),
    });
  });
}

function addNode(type/*: 'voice' | 'space'*/) {
  const idx = type === 'voice' ? voices.length : spaces.length;
  const id = `${type}-${idx}`;

  let node;
  if (type === 'voice') {
    node = new FormantVoice(context, { frequency: randFreq(), gain: randGain(), formants: [randFreq(), randFreq(), randFreq()] });
    voices.push(node);
  } else if (type === 'space') {
    node = new Space(context, { delayTime: randDT(), fb: 0.7 });
    node.connect(output);

    spaces.push(node);
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

function connect(source, target) {
  const src = flow.value.graph.get(source)
  const tgt = flow.value.graph.get(target)
  
  console.log(`connecting ${source} to ${target}`, src, tgt);

  if (!src || !tgt) return

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

const voices = [];
const spaces = [];

setInterval(update, CONTROL_TIME);
</script>

<template>
  <h1>Resonant Life</h1>
  <button id="resume" @click="context.resume()">ctx.resume</button>
  <button @click="addNode('voice')">add voice</button>
  <button @click="addNode('space')">add space</button>
  <input id='gain' @input="event => output.master.gain.exponentialRampToValueAtTime(event.target.value, context.currentTime + 0.010)"
    type="range" min="0.0001" max="1" step="0.0001" value="0.5"
  />
  <div id="flow" style="height: 75vh; width: 100vw;">
    <Flow
      ref="flow"
      @edge-add="connect"
      @edge-remove="disconnect"
    />
  </div>
</template>
