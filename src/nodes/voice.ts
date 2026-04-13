import { Node } from './node';
import { ADSR } from './misc';
import { AR_TICK_SIZE } from './node';
import { Random } from '../lib';
import { rand_type, rand_freq, random_formants } from './formant';

import * as Tone from 'tone';

export abstract class Voice extends Node {
  constructor(ctx: AudioContext, base?: any) { super(ctx, base); }
  input() { return undefined }
}

export class SineVoice extends Voice {
  osc: Tone.Oscillator;
  gain: GainNode;
  adsr: ADSR;
  
  constructor(ctx: AudioContext, base?: any) {
    super(ctx, base);

    this.base = {
      frequency: 440, 
      gain: 1,
      attack: 0.02,
      decay: 0,
      sustain: 1,
      release: 0.05,
      ...this.base,
    };

    this.osc = new Tone.Oscillator({
      type: "sine",
      frequency: this.base.frequency,
    });
    this.gain = ctx.createGain();
    this.adsr = new ADSR(ctx, this.base.attack, this.base.decay, this.base.sustain, this.base.release);
    
    this.osc.connect(this.adsr.input());
    this.adsr.output().connect(this.gain);
    
    this.gain.gain.value = 1;
    
    this.osc.start();
  }

  setFrequency(value: number, time: number) {
    this.osc.frequency.linearRampToValueAtTime(value, time);
  }

  setGain(value: number, time: number) {
    this.gain.gain.linearRampToValueAtTime(value, time);
  }

  triggerADSR(time: number) {
    this.adsr.trig(time);
  }

  updaters(delta?: { time: number, frequency: number, gain: number }) {
    return {
      frequency: {
        object: this,
        update_fn: this.setFrequency,
        args: [this.base.frequency * (delta?.frequency ?? 1), this.ctx.currentTime + AR_TICK_SIZE],
      },
      gain: {
        object: this,
        update_fn: this.setGain,
        args: [this.base.gain * (delta?.gain ?? 1), this.ctx.currentTime + AR_TICK_SIZE],
      },
      adsr: {
        object: this,
        update_fn: this.triggerADSR,
        args: [this.ctx.currentTime + AR_TICK_SIZE],
      }
    };
  }
  
  static randomize(): any {
    return {
      frequency: Random.uniform().linexp(0, 1, 110, 880).sample(),
      gain:      Random.uniform().linexp(0, 1, 0.3, 1.0).sample(),
      attack:    Random.uniform().linexp(0, 1, 0.02, 0.3).sample(),
      decay:     Random.uniform().linexp(0, 1, 0.01, 0.3).sample(),
      sustain:   Random.uniform().linexp(0, 1, 0.3, 1.0).sample(),
      release:   Random.uniform().linexp(0, 1, 0.05, 0.5).sample(),
    };
  }

  output() { return this.gain; }
}

export class FormantVoice extends SineVoice {
  filters: Tone.Filter[];

  constructor(ctx: AudioContext, base?: any) {
    super(ctx, base);
    this.osc.type = "sawtooth";

    const defaults = {
      frequency: 440, 
      gain: 1,
      formants: [
        { freq: 500, Q: 5 },
        { freq: 1500, Q: 5 },
        { freq: 2500, Q: 5 },
      ],
    };

    this.base = {
      ...defaults,
      ...this.base,
      formants: this.base?.formants ?? defaults.formants,
    };

    this.osc.disconnect();

    this.filters = this.base.formants.map((formant: { freq: number, Q: number }) => {
      const filter = new Tone.Filter({
        type: "bandpass",
        frequency: formant.freq,
        Q: formant.Q,
      });

      this.osc.connect(filter);
      filter.connect(this.adsr.input());

      return filter;
    });
  }

  static randomize(): any {
    const type = rand_type();
    return {
      frequency: rand_freq(type),
      gain:      Random.uniform().linexp(0, 1, 0.3, 1.0).sample(),
      attack:    Random.uniform().linexp(0, 1, 0.02, 0.3).sample(),
      decay:     Random.uniform().linexp(0, 1, 0.01, 0.3).sample(),
      sustain:   Random.uniform().linexp(0, 1, 0.3, 1.0).sample(),
      release:   Random.uniform().linexp(0, 1, 0.05, 0.5).sample(),
      formants:  random_formants(type),
    };
  }

  output() { return this.gain; }
}

export class FMVoice extends Voice {
  fmsynth: Tone.FMSynth;
  gain: GainNode;
  
  constructor(ctx: AudioContext, base?: any) {
    super(ctx, base);
    this.fmsynth = new Tone.FMSynth();
    this.gain = ctx.createGain();
    this.fmsynth.connect(this.gain);
    
    if (!this.base) this.base = {
      frequency: 440, 
      gain: 1,
    };

    this.fmsynth.frequency.value = this.base.frequency;
    this.fmsynth.volume.value = -Infinity;
  }
  
  updaters(delta?: { time: number, frequency: number, gain: number }) {
    return {
      frequency: {
        object: this.fmsynth.frequency,
        update_fn: this.fmsynth.frequency.linearRampToValueAtTime,
        args: [this.base.frequency * (delta?.frequency ?? 1), this.ctx.currentTime + AR_TICK_SIZE],
      },
      gain: {
        object: this.fmsynth.volume,
        update_fn: this.fmsynth.volume.linearRampToValueAtTime,
        args: [20 * Math.log10(this.base.gain * (delta?.gain ?? 1)), this.ctx.currentTime + AR_TICK_SIZE],
      },
    };
  }
  
  output() { return this.gain; }
}

export class NoiseVoice extends Voice {
  noise: Tone.Noise;
  gain: GainNode;
  
  constructor(ctx: AudioContext, base?: any) {
    super(ctx, base);
    this.noise = new Tone.Noise("white").toDestination();
    this.gain = ctx.createGain();
    
    if (!this.base) this.base = {
      gain: 1,
    };

    this.noise.connect(this.gain);
    this.gain.gain.value = 0;
    this.noise.start();
  }
  
  updaters(delta?: { time: number, gain: number }) {
    return {
      gain: {
        object: this.gain.gain,
        update_fn: this.gain.gain.linearRampToValueAtTime,
        args: [this.base.gain * (delta?.gain ?? 1), this.ctx.currentTime + AR_TICK_SIZE],
      },
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
    const entries = Object.entries(this.registry);
    if (entries.length === 0) throw new Error("No voices registered");
    const [, ctor] = entries[Random.uniform().linlin(0, 1, 0, entries.length).floor().sample()];
    const randomBase = (ctor as any).randomize ? (ctor as any).randomize() : {};
    return new ctor(ctx, { ...randomBase, ...base });
  }
}
