import { randomRGB, linexp, Voice, EchoDelay, Scaler } from "./lib.js";

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

const context = new AudioContext();

const master = new GainNode(context);
master.connect(context.destination);

const N = 10;

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

const noise_hp = new BiquadFilterNode(context);
noise_hp.type = "highpass"

const noise_lfo = new OscillatorNode(context);
noise_lfo.frequency.value = 0.2;
noise_lfo.start()

const noise_scaler = new Scaler(context, -1, 1, 100, 12000);
noise_lfo.connect(noise_scaler.a).connect(noise_hp.frequency);

const voices = Array.from({ length: N }, () => new Voice(context));
const delays = Array.from({ length: N }, () => new EchoDelay(context));

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

tick()