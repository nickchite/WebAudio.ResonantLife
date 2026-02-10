function randomRGB() {
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  return `rgb(${r}, ${g}, ${b})`;
}

function linlin(value, inMin, inMax, outMin, outMax) {
  return outMin + (outMax - outMin) * (value - inMin) / (inMax - inMin);
}

function linexp(value, inMin, inMax, outMin, outMax) {
  return outMin * Math.pow(outMax / outMin, (value - inMin) / (inMax - inMin));
}

function explin(value, inMin, inMax, outMin, outMax) {
  return inMin * Math.pow(inMax / inMin, (value - outMin) / (outMax - outMin));
}

function expexp(value, inMin, inMax, outMin, outMax) {
  return outMin * Math.pow(outMax / outMin, (value - inMin) / (inMax - inMin));
}

function randFreq() { return linexp(Math.random(), 0, 1, 40, 1280); }
function randGain() { return linexp(Math.random(), 0, 1, 0.001, 1); }
function randDT() { return linexp(Math.random(), 0, 1, 0.001, 0.500); }

function tick() {
  oscs.forEach((osc, i) => {
    const osc_gain = gains[i];
    if (osc.context.currentTime > osc.nextTick) {
      const delay = -Math.log(1 - Math.random())
      osc.nextTick = osc.context.currentTime + delay;
      osc.frequency.setValueAtTime(randFreq(), osc.nextTick);
      osc_gain.gain.exponentialRampToValueAtTime(randGain() / Math.sqrt(N), osc.nextTick);
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

const oscs = Array.from({ length: N }, () => new OscillatorNode(context));
const gains = Array.from({ length: N }, () => new GainNode(context));
const delays = Array.from({ length: N }, () => new DelayNode(context));
const fbs = Array.from({ length: N }, () => new GainNode(context));
const master = new GainNode(context);

master.gain.value = 0;

for (let i = 0; i < N; ++i) {
  const osc = oscs[i];
  osc.frequency.value = randFreq();

  const gain = gains[i];
  gain.gain.value = randGain() / Math.sqrt(N);

  const delay = delays[i];
  delay.delayTime.value = 0.100; //randDT();
  
  const fb = fbs[i];
  fb.gain.value = 0.6 + 0.35 * Math.random();

  osc.connect(gain);
  gain.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(master);
  gain.connect(master);

  osc.nextTick = osc.context.currentTime;
  osc.start();

}
noise.connect(noise_hp).connect(noise_gain).connect(master);
master.connect(context.destination);

tick()