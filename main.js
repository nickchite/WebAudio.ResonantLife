import { randomRGB, linexp, Voice, DelayLine, Scaler, Noise } from "./lib.js";

function randFreq() { return linexp(Math.random(), 0, 1, 200, 1600); }
function randGain() { return linexp(Math.random(), 0, 1, 0.1, 1); }
function randDT() { return linexp(Math.random(), 0, 1, 0.001, 0.500); }

// Gaussian (normal) random number
function randomNormal(mean = 0, std = 1) {
  const u1 = Math.random();
  const u2 = Math.random();

  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  return z0 * std + mean;
}

function tick() {
  voices.forEach((voice) => {
    voice.update({ 
      time: -Math.log(1 - Math.random()),
      freq: randomNormal(1, 0.02),
      gain: randGain()
    });
  });
  
  setTimeout(tick, 10);
}

document.querySelector("button").onclick = () => {
  document.body.style.backgroundColor = randomRGB();
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
noise_scaler.output().connect(noise_hp.frequency);

const voices = [];
const delays = [];

const delay = new DelayLine(context);
  delay.output().connect(master);
delays.push(delay);

tick()