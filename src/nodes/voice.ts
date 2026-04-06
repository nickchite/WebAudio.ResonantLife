import { Node } from './node';
import { ADSR } from './misc';
import { AR_TICK_SIZE } from './node';
import { Random } from '../lib';

export abstract class Voice extends Node {
  constructor(ctx: AudioContext, base?: any) { super(ctx, base); }
  input() { return undefined }
}

export class SineVoice extends Voice {
  osc: OscillatorNode;
  gain: GainNode;
  adsr: ADSR;
  
  constructor(ctx: AudioContext, base?: any) {
    super(ctx, base);
    
    if (!this.base) this.base = {
      frequency: 440, 
      gain: 1,
    };

    this.osc = ctx.createOscillator();
    this.gain = ctx.createGain();
    this.adsr = new ADSR(ctx, 0.02, 0, 1, 0.05);
    
    this.osc.connect(this.adsr.input());
    this.adsr.output().connect(this.gain);
    
    this.osc.frequency.value = this.base.frequency;
    this.gain.gain.value = 0;
    
    this.osc.start();
  }

  updaters(delta?: { time: number, frequency: number, gain: number }) {
    return {
      frequency: {
        object: this.osc.frequency,
        update_fn: this.osc.frequency.linearRampToValueAtTime,
        args: [this.base.frequency * (delta?.frequency ?? 1), this.ctx.currentTime + AR_TICK_SIZE],
      },
      gain: {
        object: this.gain.gain,
        update_fn: this.gain.gain.linearRampToValueAtTime,
        args: [this.base.gain * (delta?.gain ?? 1), this.ctx.currentTime + AR_TICK_SIZE],
      },
      adsr: {
        object: this.adsr,
        update_fn: this.adsr.trig,
        args: [this.ctx.currentTime + AR_TICK_SIZE],
      }
    };
  }
  
  output() { return this.gain; }
}

export class FormantVoice extends SineVoice {
  filters: BiquadFilterNode[];

  constructor(ctx: AudioContext, base?: any) {
    super(ctx, base);
    this.osc.type = "sawtooth";

    if (!this.base.formants) this.base = {
      frequency: 440, 
      gain: 1,
      formants: [
        { freq: 500, Q: 5 },
        { freq: 1500, Q: 5 },
        { freq: 2500, Q: 5 },
      ],
    };
    
    this.filters = this.base.formants.map((formant: { freq: number, Q: number }) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = formant.freq;
      filter.Q.value = formant.Q;
      this.osc.disconnect();
      this.osc.connect(filter).connect(this.adsr.input());
      return filter;
    });
  }
  
  updaters(delta?: { time: number, frequency: number, gain: number }) {
    return {
      frequency: {
        object: this.osc.frequency,
        update_fn: this.osc.frequency.linearRampToValueAtTime,
        args: [this.base.frequency * (delta?.frequency ?? 1), this.ctx.currentTime + AR_TICK_SIZE],
      },
      gain: {
        object: this.gain.gain,
        update_fn: this.gain.gain.linearRampToValueAtTime,
        args: [this.base.gain * (delta?.gain ?? 1), this.ctx.currentTime + AR_TICK_SIZE],
      },
      adsr: {
        object: this.adsr,
        update_fn: this.adsr.trig,
        args: [this.ctx.currentTime + AR_TICK_SIZE],
      }
    };
  }

  output() { return this.gain; }
}

type VoiceConstructor = new (ctx: AudioContext, base: any) => Voice;

export class VoiceFactory {
  private static registry: Record<string, VoiceConstructor> = {
    "sine": SineVoice,
    "formant": FormantVoice,
  };
  
  static register(name: string, ctor: VoiceConstructor) {
    if (this.registry.hasOwnProperty(name)) throw new Error(`Voice ${name} already registered`);
    this.registry[name] = ctor;
    console.log(`Registered voice: ${name}`, ctor);
  }

  static createRandom(ctx: AudioContext, base?: any): Voice {
    const constructors = Object.values(this.registry);
    if (constructors.length === 0) throw new Error("No voices registered");
    const ctor = constructors[Random.uniform().linlin(0, 1, 0, constructors.length).floor().sample()];
    return new ctor(ctx, base);
  }
}
