import { Random, linexp, Voice, DelayLine, Scaler, Noise, FormantVoice } from "./lib.js";

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

document.querySelector("button").onclick = () => {
  document.body.style.backgroundColor = Random.rgb();
  context.resume();
  
  const voice = new Voice(context, { frequency: randFreq() });
  voice.output().connect(delays[0].input());
  voices.push(voice);
}

document.querySelector("#gain").oninput = (event) => {
  master.gain.exponentialRampToValueAtTime(event.target.value, context.currentTime + 0.010);
}

const context = new AudioContext();

const master = new GainNode(context, { gain: 0 });
master.connect(context.destination);

/* const noise = new Noise(context);

const noise_hp = new BiquadFilterNode(context, { type: "highpass", frequency: 100 });
const noise_lfo = new OscillatorNode(context, { type: "sine", frequency: 0.2 });
noise_lfo.start()

const noise_scaler = new Scaler(context, -1, 1, 100, 12000);
noise_lfo.connect(noise_scaler.input())
noise_scaler.output().connect(noise_hp.frequency); */

const voices = [];
const delays = [];

const delay = new DelayLine(context);
delay.output().connect(master);
delays.push(delay);

setInterval(update, CONTROL_TIME);

// const A_formant_freqs = [730, 1090, 2440];
// const E_formant_freqs = [660, 1700, 2400];
// const I_formant_freqs = [440, 1220, 2600];
// const O_formant_freqs = [360, 750, 2400];
// const U_formant_freqs = [270, 600, 2400];

// const formant = new FormantVoice(context, I_formant_freqs);
// formant.output().connect(delays[0].input());
// formant.osc.nextTick = formant.osc.context.currentTime;
// globalThis.formant = formant;

// noise.output().connect(noise_hp).connect(master);