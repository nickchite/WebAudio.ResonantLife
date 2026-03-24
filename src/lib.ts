export class Random {
  static linlin(inMin: number, inMax: number, outMin: number, outMax: number) {
    return linlin(Math.random(), inMin, inMax, outMin, outMax);
  }
  
  static linexp(inMin: number, inMax: number, outMin: number, outMax: number) {
    return linexp(Math.random(), inMin, inMax, outMin, outMax);
  }

  static normal(mean = 0, std = 1) {
    const u1 = Math.random();
    const u2 = Math.random();

    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    return z0 * std + mean;
  }
  
  static rgb() {
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    return `rgb(${r}, ${g}, ${b})`;
  }
  
  static exponential(lambda: number) {
    return -Math.log(1 - Math.random()) / lambda;
  }
}

/**
 * 
 * @param value input value
 * @param inMin input minimum
 * @param inMax input maximum
 * @param outMin output minimum
 * @param outMax output maximum
 * @returns value scaled from linear input min/max to linearoutput min/max
 */
export function linlin(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin + (outMax - outMin) * (value - inMin) / (inMax - inMin);
}

/**
 * 
 * @param value input value
 * @param inMin input minimum
 * @param inMax input maximum
 * @param outMin output minimum
 * @param outMax output maximum
 * @returns value scaled from linear input min/max to exponential output min/max
 */
export function linexp(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin * Math.pow(outMax / outMin, (value - inMin) / (inMax - inMin));
}

/**
 * 
 * @param value input value
 * @param inMin input minimum
 * @param inMax input maximum
 * @param outMin output minimum
 * @param outMax output maximum
 * @returns value scaled from exponential input min/max to exponential output min/max
 */
export function explin(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return inMin * Math.pow(inMax / inMin, (value - outMin) / (outMax - outMin));
}

/**
 * 
 * @param value input value
 * @param inMin input minimum
 * @param inMax input maximum
 * @param outMin output minimum
 * @param outMax output maximum
 * @returns value scaled from linear input min/max to exponential output min/max
 */
export function expexp(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin * Math.pow(outMax / outMin, (value - inMin) / (inMax - inMin));
}

/**
 * 
 * @param amp input in linear amplitude
 * @returns output in decibels
 */
export function amp_to_db(amp: number) { return 20 * Math.log10(amp); }

/**
 * 
 * @param db input in decibels
 * @returns output in linear amplitude
 */
export function db_to_amp(db: number) { return Math.pow(10, db / 20); }

/**
 * 
 * @param freq input frequency
 * @returns output in MIDI
 */
export function freq_to_midi(freq: number) { return 69 + 12 * Math.log2(freq / 440); }

/**
 * 
 * @param midi input in MIDI
 * @returns output in frequency
 */
export function midi_to_freq(midi: number) { return 440 * Math.pow(2, (midi - 69) / 12); }

export abstract class Node {
  ctx: AudioContext;
  nextTick: number;
  base: any;
  fanIn: number = 0;
  fanGain: GainNode;
  
  constructor(ctx: AudioContext, base?: any) { 
    this.ctx = ctx;
    this.nextTick = this.ctx.currentTime;
    this.base = base;
    this.fanGain = new GainNode(ctx, { gain: 1 });
  }

  connect(destination: Node): Node {
    this.output().connect(destination.input());
    destination.fanGain.gain.value = 1 / ++destination.fanIn;
    return destination;
  }

  disconnect(destination: Node): void {
    this.output().disconnect(destination.fanGain);
    destination.fanGain.gain.value = 1 / Math.max(1, --destination.fanIn);
    return undefined;
  }
  
  update(delta?: any) {
    this.nextTick = this.ctx.currentTime + delta.time;
  }
  
  abstract input(): AudioNode;
  abstract output(): AudioNode;
}

export class Voice extends Node {
  osc: OscillatorNode;
  gain: GainNode;
  adsr: ADSR;
  
  constructor(ctx: AudioContext, base: any) {
    super(ctx, base);
    this.osc = new OscillatorNode(ctx);
    this.gain = new GainNode(ctx);
    this.adsr = new ADSR(ctx, 0.01, 0.1, 0.8, 0.5);
    
    this.osc.connect(this.adsr.input());
    this.adsr.output().connect(this.gain);
    
    this.osc.frequency.value = base.frequency;
    this.gain.gain.value = 0;
    
    this.osc.start();
  }
  
  update(delta?: any) { 
    if (this.ctx.currentTime > this.nextTick) {
      super.update(delta);
      this.osc.frequency.setValueAtTime(this.base.frequency * delta.freq, this.nextTick);
      this.gain.gain.setValueAtTime(this.base.gain * delta.gain, this.nextTick);
      this.adsr.trig();
    }
  }
  
  input() { return undefined; }
  output() { return this.gain; }
}

export class Space extends Node {
  delay: DelayNode;
  feedback: GainNode; 
  feedforward: GainNode;
  
  constructor(ctx: AudioContext, base: any) {
    super(ctx, base);
    this.delay = new DelayNode(ctx, { maxDelayTime: 3 });
    this.feedback = new GainNode(ctx, { gain: 0.8 });
    this.feedforward = new GainNode(ctx, { gain: 0 });

    this.delay.delayTime.value = base.delayTime;
    
    this.fanGain.connect(this.delay);
    this.delay.connect(this.feedback).connect(this.delay);
    this.delay.connect(this.feedforward);
  }
  
  update(delta?: any) {
    if (this.ctx.currentTime > this.nextTick) {
      super.update(delta);
      this.delay.delayTime.setValueAtTime(this.base.delayTime * delta.dt, this.nextTick);
    }
  }
  
  input() { return this.fanGain; }
  output() { return this.delay; }
}

export class Output extends Node {
  master: GainNode;

  constructor(ctx: AudioContext) {
    super(ctx);
    this.master = new GainNode(ctx);
    this.fanGain.connect(this.master).connect(this.ctx.destination);
  }
  
  input() { return this.fanGain; }
  output() { return undefined; }
}


export class FormantVoice extends Node {
  osc: OscillatorNode;
  gain: GainNode;
  filters: BiquadFilterNode[];

  constructor(ctx: AudioContext, formants: number[]) {
    super(ctx);
    this.osc = new OscillatorNode(ctx);
    this.osc.type = "sawtooth";
    this.osc.frequency.value = 600;
    this.osc.start();

    this.gain = new GainNode(ctx);
    //this.gain.gain.value = randGain() / Math.sqrt(N);
    this.gain.gain.value = 1;

    this.filters = formants.map((f) => {
      const filter = new BiquadFilterNode(ctx, { type: "bandpass", frequency: f, Q: 10 });
      this.osc.connect(filter).connect(this.gain);
      return filter;
    });
  }

  input() { return undefined; }
  output() { return this.gain; }
}

export class Scaler extends Node {
  gain: GainNode;
  constant: ConstantSourceNode;
  inMin: number;
  inMax: number;
  outMin: number;
  outMax: number;

  constructor(ctx: AudioContext, inMin: number, inMax: number, outMin: number, outMax: number) {
    super(ctx);
    this.inMin = inMin;
    this.inMax = inMax;
    this.outMin = outMin;
    this.outMax = outMax;

    this.gain = new GainNode(this.ctx);
    this.constant = new ConstantSourceNode(this.ctx);
    
    this.gain.gain.value = (outMax - outMin) / (inMax - inMin);
    this.constant.offset.value = (outMin - inMin * this.gain.gain.value) / this.gain.gain.value;
      
    this.constant.connect(this.gain);
  }
  
  input() { return this.gain; }
  output() { return this.gain; }
}

export class Noise extends Node {
  noise: ScriptProcessorNode;
  gain: GainNode
  bufferSize: number = 4096;

  constructor(ctx: AudioContext) {
    super(ctx);
    this.noise = this.ctx.createScriptProcessor(this.bufferSize, 1, 1);
    this.gain = new GainNode(this.ctx, { gain: 1e-2 });

    // https://noisehack.com/generate-noise-web-audio-api
    const bufferSize = 4096;
    this.noise.onaudioprocess = (e) => {
      var output = e.outputBuffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) {
          output[i] = Math.random() * 2 - 1;
      }
    }
    
    this.noise.connect(this.gain);
  }
  
  input() { return undefined; }
  output() { return this.gain; }
}

export class SoundFilePlayer extends Node {
  source: AudioBufferSourceNode;

  constructor(ctx: AudioContext) {
    super(ctx);
    this.source = new AudioBufferSourceNode(ctx);
  }

  async load(filename: string) {
   this.source.buffer = await fetch(filename)
      .then(file => file.arrayBuffer())
      .then(buffer => this.ctx.decodeAudioData(buffer));
  } 
    
  play() { this.source.start(); }
  stop() { this.source.stop(); }
  
  input() { return undefined; }
  output() { return this.source; }
}

class SoundIn extends Node {
  source?: MediaStreamAudioSourceNode;

  constructor(ctx: AudioContext) {
    super(ctx);
  }

  async load() {
    await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    })
    .then((stream) => { this.source = new MediaStreamAudioSourceNode(this.ctx, { mediaStream: stream }); });
  } 
  
  stop() { this.source?.disconnect(); }
  
  input() { return undefined; }
  output() { return this.source; }
}

export class ConvolutionReverb extends Node {
    convolver: ConvolverNode;

    constructor(ctx: AudioContext) {
      super(ctx);
      this.convolver = new ConvolverNode(ctx);
    }
    
    load(filename: string) {
        fetch(filename)
            .then(response => response.arrayBuffer())
            .then(arrayBuffer => this.ctx.decodeAudioData(arrayBuffer))
            .then(audioBuffer => { this.convolver.buffer = audioBuffer; })
            .catch(error => console.error('Error loading impulse response:', error));
    }
    
    input() { return this.convolver; }
    output() { return this.convolver; }
}

export class ADSR extends Node {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  gain: GainNode;

  constructor(ctx: AudioContext, attack: number, decay: number, sustain: number, release: number) {
    super(ctx);
    this.attack = attack;
    this.decay = decay;
    this.sustain = sustain;
    this.release = release;
    
    this.gain = new GainNode(this.ctx, { gain: 0 });
  }
  
  trig() {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(1, now + this.attack);
    this.gain.gain.linearRampToValueAtTime(this.sustain, now + this.attack + this.decay);
    this.gain.gain.linearRampToValueAtTime(0, now + this.attack + this.decay + this.release);
  }
  
  start() {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(1, now + this.attack);
    this.gain.gain.linearRampToValueAtTime(this.sustain, now + this.attack + this.decay);
  }

  stop() {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + this.release);
  }
  
  input() { return this.gain; }
  output() { return this.gain; }
}