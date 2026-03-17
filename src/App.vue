<script setup lang="js">
import { Random, linexp, Voice, DelayLine, Scaler, Noise, FormantVoice } from "./lib.ts";

const CONTROL_RATE = 100;
const CONTROL_TIME = 1000 / CONTROL_RATE;

function randFreq() { return Random.linexp(0, 1, 200, 1600); }
function randGain() { return Random.linexp(0, 1, 0.1, 1); }
function randDT() { return Random.linexp(0, 1, 0.001, 0.500); }

function update() {
  voices.forEach((voice) => {
    voice.update({ 
      time: Random.exponential(1),
      freq: Random.normal(1, 0.02),
      gain: randGain()
    });
  });
}

function addVoice() {
  document.body.style.backgroundColor = Random.rgb();
  const voice = new Voice(context, { frequency: randFreq() });
  voice.output().connect(delays[0].input());
  voices.push(voice);
  console.log(voices)
}

const context = new AudioContext();

function setMasterGain(event) {
  
}

const master = new GainNode(context, { gain: 0 });
master.connect(context.destination);

const voices = [];
const delays = [];

const delay = new DelayLine(context);
delay.output().connect(master);
delays.push(delay);

setInterval(update, CONTROL_TIME);
</script>

<template>
  <h1>Resonant Life</h1>
  <button id="resume" @click="context.resume()">ctx.resume</button>
  <button id="add" @click="addVoice()">add voice</button>
  <input id='gain' @input="event => master.gain.exponentialRampToValueAtTime(event.target.value, context.currentTime + 0.010)"
    type="range" min="0" max="1" step="0.001" value="0.5"
  />
</template>
