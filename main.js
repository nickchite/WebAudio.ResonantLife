import { randomRGB, linexp, Voice, EchoDelay } from "./lib.js";

function randFreq() { return linexp(Math.random(), 0, 1, 40, 1280); }
function randGain() { return linexp(Math.random(), 0, 1, 0.001, 1); }
function randDT() { return linexp(Math.random(), 0, 1, 0.001, 0.500); }

function tick() {
  voices.forEach((voice) => {
    if (voice.osc.context.currentTime > voice.osc.nextTick) {
      const dt = -Math.log(1 - Math.random())
      voice.osc.nextTick = voice.osc.context.currentTime + dt;
      voice.osc.frequency.setValueAtTime(randFreq(), voice.osc.nextTick);
      voice.gain.gain.exponentialRampToValueAtTime(randGain() / Math.sqrt(N), voice.osc.nextTick);
    }
  });
  
  setTimeout(tick, 10);
}

document.querySelector("button").onclick = () => {
  document.body.style.backgroundColor = randomRGB();
  context.resume();
}

document.querySelector("#gain").oninput = (event) => {
  master.gain.exponentialRampToValueAtTime(event.target.value, context.currentTime + 0.010);
}

const N = 10;

const context = new AudioContext();

// https://noisehack.com/generate-noise-web-audio-api/
const bufferSize = 4096;
const noise = context.createScriptProcessor(bufferSize, 1, 1);
noise.onaudioprocess = function(e) {
    var output = e.outputBuffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
}

const noise_gain = new GainNode(context);
noise_gain.gain.value = 1e-2;

const noise_lfo = new OscillatorNode(context);
noise_lfo.frequency.value = 0.2;
noise_lfo.start()

const noise_lfo_gain = new GainNode(context);
noise_lfo_gain.gain.value = 1000;
noise_lfo.connect(noise_lfo_gain);

const noise_lfo_constant = new ConstantSourceNode(context);
noise_lfo_constant.offset.value = 10500;
noise_lfo_constant.start()

const noise_hp = new BiquadFilterNode(context);
noise_hp.type = "highpass"

noise_lfo_constant.connect(noise_hp.frequency);
noise_lfo_gain.connect(noise_hp.frequency);

// const oscs = Array.from({ length: N }, () => new OscillatorNode(context));
// const gains = Array.from({ length: N }, () => new GainNode(context));
// const delays = Array.from({ length: N }, () => new DelayNode(context));
// const fbs = Array.from({ length: N }, () => new GainNode(context));
const voices = Array.from({ length: N }, () => new Voice(context));
const delays = Array.from({ length: N }, () => new EchoDelay(context));
const master = new GainNode(context);

master.gain.value = 0;

for (let i = 0; i < N; ++i) {
  const voice = voices[i];
  voice.osc.frequency.value = randFreq();
  voice.gain.gain.value = randGain() / Math.sqrt(N);

  const delay = delays[i];
  delay.delay.delayTime.value = 0.100; //randDT(); 
  delay.fb.gain.value = 0.6 + 0.35 * Math.random();
  
  voice.connect(delay.delay).connect(master);
  
  voice.osc.nextTick = voice.osc.context.currentTime;
  voice.osc.start();

}

noise.connect(noise_hp).connect(noise_gain).connect(master);
master.connect(context.destination);

tick()