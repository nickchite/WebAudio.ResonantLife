function randomRGB() {
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  return `rgb(${r}, ${g}, ${b})`;
}

function randFreq() {
  const min = 60;
  const max = 600;
  return min * Math.pow(max / min, Math.random());
}

function randGain() {
  const min = 1e-3;
  const max = 1;
  return min * Math.pow(max / min, Math.random());
}

function tick() {
  oscs.forEach((osc, i) => {
    const osc_gain = osc_gains[i];
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
  gain.gain.value = event.target.value;
}

const N = 10;

const context = new AudioContext();

const oscs = Array.from({ length: N }, () => new OscillatorNode(context));
const osc_gains = Array.from({ length: N }, () => new GainNode(context));
const delay = new DelayNode(context);
const fb = new GainNode(context);
const gain = new GainNode(context);

gain.gain.value = 0.5;
fb.gain.value = 0;

fb.gain.value = 0.92;
delay.delayTime.value = 3000/1e6;

oscs.forEach((osc, i) => {
  osc.frequency.value = randFreq();
  const osc_gain = osc_gains[i];
  osc_gain.gain.value = randGain() / Math.sqrt(N);
  osc.connect(osc_gain).connect(delay);
  osc.nextTick = osc.context.currentTime;
  osc.start();
});
delay.connect(fb).connect(delay);
delay.connect(gain);
gain.connect(context.destination);

tick()