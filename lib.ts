export function randomRGB() {
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  return `rgb(${r}, ${g}, ${b})`;
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
  
  constructor(ctx: AudioContext) { this.ctx = ctx; }

  connect(destination: Node): Node {
    this.output().connect(destination.input());
    return destination;
  }
  
  abstract input(): AudioNode;
  abstract output(): AudioNode;
}

export class Voice extends Node {
  osc: OscillatorNode;
  gain: GainNode;
  
  constructor(ctx: AudioContext) {
    super(ctx);
    this.osc = new OscillatorNode(ctx);
    this.gain = new GainNode(ctx);
    
    this.osc.connect(this.gain);
  }
  
  input() { return undefined; }
  output() { return this.gain; }
}

export class DelayLine extends Node {
  delay: DelayNode;
  feedback: GainNode; 
  feedforward: GainNode;
  
  constructor(ctx: AudioContext) {
    super(ctx);
    this.delay = new DelayNode(ctx);
    this.feedback = new GainNode(ctx, { gain: 0 });
    this.feedforward = new GainNode(ctx, { gain: 0 });

    this.delay.connect(this.feedback).connect(this.delay);
    this.delay.connect(this.feedforward);
  }
  
  input() { return this.delay; }
  output() { return this.delay; }
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
