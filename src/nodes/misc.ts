import { AR_TICK_SIZE, Node } from './node';
import * as Tone from 'tone';

export class Output extends Node {
  master: GainNode;

  constructor(ctx: AudioContext) {
    super(ctx);
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.fanGain.connect(this.master);
    Tone.connect(this.master as any, Tone.getDestination() as any);
  }
  
  input() { return this.fanGain; }
  output() { return undefined; }
  updaters(delta?: { [param: string]: any; }): Record<string, { object: Object; update_fn: Function; args: number[]; }> | undefined {
    throw new Error('Method not implemented.');
  }
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

    this.gain = this.ctx.createGain();
    this.constant = this.ctx.createConstantSource();
    
    this.gain.gain.value = (outMax - outMin) / (inMax - inMin);
    this.constant.offset.value = (outMin - inMin * this.gain.gain.value) / this.gain.gain.value;
      
    this.constant.connect(this.gain);
  }
  
  input() { return this.gain; }
  output() { return this.gain; }
}

export class Noise extends Node {
  noise: ScriptProcessorNode;
  gain: GainNode;
  bufferSize: number = 4096;

  constructor(ctx: AudioContext) {
    super(ctx);
    this.noise = this.ctx.createScriptProcessor(this.bufferSize, 1, 1);
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 1e-2;

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
    this.source = ctx.createBufferSource();
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
    .then((stream) => {
      this.source = this.ctx.createMediaStreamSource(stream);
    });
  } 
  
  stop() { this.source?.disconnect(); }
  
  input() { return undefined; }
  output() { return this.source; }
}

export class ConvolutionReverb extends Node {
    convolver: ConvolverNode;

    constructor(ctx: AudioContext) {
      super(ctx);
      this.convolver = ctx.createConvolver();
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
    
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
  }
  
  trig(time: number) {
    const now = this.ctx.currentTime + AR_TICK_SIZE;
    this.gain.gain.cancelAndHoldAtTime(now);
    // Ramp to zero by `time` so the attack always starts from silence.
    this.gain.gain.setValueAtTime(this.gain.gain.value, time);
    this.gain.gain.linearRampToValueAtTime(0, time);
    this.gain.gain.linearRampToValueAtTime(1, time + this.attack);
    this.gain.gain.linearRampToValueAtTime(this.sustain, time + this.attack + this.decay);
    this.gain.gain.linearRampToValueAtTime(0, time + this.attack + this.decay + this.release);
  }
  
  start() {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelAndHoldAtTime(now);
    this.gain.gain.linearRampToValueAtTime(1, now + this.attack);
    this.gain.gain.linearRampToValueAtTime(this.sustain, now + this.attack + this.decay);
  }

  stop() {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelAndHoldAtTime(now);
    this.gain.gain.linearRampToValueAtTime(0, now + this.release);
  }
  
  input() { return this.gain; }
  output() { return this.gain; }
}

export class Comb {
  delay: DelayNode;
  feedback: GainNode;
  inputNode: GainNode;
  outputNode: GainNode;

  constructor(ctx: AudioContext, delayTime: number, decay: number) {
    this.inputNode = ctx.createGain();
    this.outputNode = ctx.createGain();

    this.delay = ctx.createDelay(3);
    this.delay.delayTime.value = delayTime;

    this.feedback = ctx.createGain();
    this.feedback.gain.value = decay; 

    this.inputNode.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.outputNode);
  }

  input(): AudioNode { return this.inputNode; }
  output(): AudioNode { return this.outputNode; }

  setDecay(value: number) {
    this.feedback.gain.value = value;
  }
}

export class AllPass {
  delay: DelayNode;
  feedback: GainNode;
  inputNode: GainNode;
  outputNode: GainNode;
  inverter: GainNode;

  constructor(ctx: AudioContext, delayTime: number, feedbackGain: number) {
    this.inputNode = ctx.createGain();
    this.outputNode = ctx.createGain();

    // y = -x + delay + feedback
    this.inverter = ctx.createGain();
    this.inverter.gain.value = -1;

    this.delay = ctx.createDelay(0.05);
    this.delay.delayTime.value = delayTime;

    this.feedback = ctx.createGain();
    this.feedback.gain.value = feedbackGain;

    this.inputNode.connect(this.inverter);
    this.inverter.connect(this.outputNode);

    this.inputNode.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.outputNode);
  }

  input(): AudioNode { return this.inputNode; }
  output(): AudioNode { return this.outputNode; }

  setFeedback(value: number) {
    this.feedback.gain.value = value;
  }
}