import { Node } from './node';

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