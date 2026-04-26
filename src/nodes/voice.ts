import { Node } from './node';
import { ADSR } from './misc';
import { AR_TICK_SIZE } from './node';
import { Random } from '../lib';
import { rand_type, rand_freq, random_formants } from './formant';

import * as Tone from 'tone';

export abstract class Voice extends Node {
  constructor(ctx: AudioContext, base?: any) { super(ctx, base); }
  input() { return undefined }

  dispose() {
    super.dispose();
  }
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

  setEnvelopeVariance(attack = 1, decay = 1, sustain = 1, release = 1) {
    this.adsr.attack = Math.max(0.005, this.base.attack * attack);
    this.adsr.decay = Math.max(0, this.base.decay * decay);
    this.adsr.sustain = Math.max(0, Math.min(1, this.base.sustain * sustain));
    this.adsr.release = Math.max(0.01, this.base.release * release);
  }

  triggerADSR(time: number) {
    this.adsr.trig(time);
  }

  updaters(delta?: {
    time: number,
    frequency: number,
    gain: number,
    attack: number,
    decay: number,
    sustain: number,
    release: number,
  }) {
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
      envelope: {
        object: this,
        update_fn: this.setEnvelopeVariance,
        args: [
          delta?.attack ?? 1,
          delta?.decay ?? 1,
          delta?.sustain ?? 1,
          delta?.release ?? 1,
        ],
      },
      adsr: {
        object: this,
        update_fn: this.triggerADSR,
        args: [this.ctx.currentTime + AR_TICK_SIZE],
      }
    };
  }
  
  static randomize(): any {
    const longMode = Math.random() < 0.2;

    const attack = longMode
      ? Random.uniform().linexp(0, 1, 0.06, 0.8).sample()
      : Random.uniform().linexp(0, 1, 0.01, 0.18).sample();

    const release = longMode
      ? Random.uniform().linexp(0, 1, 0.12, 1.2).sample()
      : Random.uniform().linexp(0, 1, 0.03, 0.5).sample();

    const decay = longMode
      ? Random.uniform().linexp(0, 1, 0.05, 0.45).sample()
      : Random.uniform().linexp(0, 1, 0.01, 0.25).sample();

    const sustain = longMode
      ? Random.uniform().linexp(0, 1, 0.55, 1.0).sample()
      : Random.uniform().linexp(0, 1, 0.2, 0.95).sample();

    return {
      frequency: Random.uniform().linexp(0, 1, 90, 1300).sample(),
      gain:      Random.uniform().linexp(0, 1, 0.6, 1.0).sample(),
      attack,
      decay,
      sustain,
      release,
    };
  }

  output() { return this.gain; }

  dispose() {
    try {
      this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.gain.gain.setValueAtTime(this.gain.gain.value, this.ctx.currentTime);
      this.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.02);
    } catch {
      // no-op
    }

    try {
      this.osc.stop(this.ctx.currentTime + 0.03);
    } catch {
      // no-op
    }

    try {
      this.osc.disconnect();
    } catch {
      // no-op
    }

    try {
      this.adsr.output().disconnect();
    } catch {
      // no-op
    }

    try {
      this.gain.disconnect();
    } catch {
      // no-op
    }

    super.dispose();
  }
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

  setFormantFrequencyRatio(ratio: number | number[] = 1, time = this.ctx.currentTime + AR_TICK_SIZE) {
    const ratios = Array.isArray(ratio) ? ratio : [ratio];
    this.filters.forEach((filter, i) => {
      const formant = this.base.formants?.[i];
      const ratioAtIndex = ratios[i] ?? ratios[ratios.length - 1] ?? 1;
      const target = Math.max(30, (formant?.freq ?? filter.frequency.value) * ratioAtIndex);
      filter.frequency.linearRampToValueAtTime(target, time);
    });
  }

  setFormantQRatio(ratio: number | number[] = 1, time = this.ctx.currentTime + AR_TICK_SIZE) {
    const ratios = Array.isArray(ratio) ? ratio : [ratio];
    this.filters.forEach((filter, i) => {
      const formant = this.base.formants?.[i];
      const ratioAtIndex = ratios[i] ?? ratios[ratios.length - 1] ?? 1;
      const target = Math.max(0.1, (formant?.Q ?? filter.Q.value) * ratioAtIndex);
      filter.Q.linearRampToValueAtTime(target, time);
    });
  }

  updaters(delta?: {
    time: number,
    frequency: number,
    gain: number,
    attack: number,
    decay: number,
    sustain: number,
    release: number,
    formantFrequency: number | number[],
    formantQ: number | number[],
  }) {
    return {
      ...super.updaters(delta),
      formantFrequency: {
        object: this,
        update_fn: this.setFormantFrequencyRatio,
        args: [delta?.formantFrequency ?? 1, this.ctx.currentTime + AR_TICK_SIZE],
      },
      formantQ: {
        object: this,
        update_fn: this.setFormantQRatio,
        args: [delta?.formantQ ?? 1, this.ctx.currentTime + AR_TICK_SIZE],
      },
    };
  }

  static randomize(): any {
    const type = rand_type();
    return {
      frequency: rand_freq(type),
      gain:      Random.uniform().linexp(0, 1, 0.6, 1.0).sample(),
      attack:    Random.uniform().linexp(0, 1, 0.02, 0.3).sample(),
      decay:     Random.uniform().linexp(0, 1, 0.01, 0.3).sample(),
      sustain:   Random.uniform().linexp(0, 1, 0.3, 1.0).sample(),
      release:   Random.uniform().linexp(0, 1, 0.05, 0.5).sample(),
      formants:  random_formants(type),
    };
  }

  output() { return this.gain; }

  dispose() {
    this.filters.forEach((filter) => {
      try {
        filter.disconnect();
      } catch {
        // no-op
      }
    });

    super.dispose();
  }
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

  dispose() {
    try {
      this.fmsynth.disconnect();
      this.fmsynth.dispose();
    } catch {
      // no-op
    }

    try {
      this.gain.disconnect();
    } catch {
      // no-op
    }

    super.dispose();
  }
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

  dispose() {
    try {
      this.noise.stop();
    } catch {
      // no-op
    }

    try {
      this.noise.disconnect();
    } catch {
      // no-op
    }

    try {
      this.gain.disconnect();
    } catch {
      // no-op
    }

    super.dispose();
  }
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

  static createNamed(ctx: AudioContext, name: string, base?: any): Voice {
    const ctor = this.registry[name];
    if (!ctor) throw new Error(`Voice ${name} is not registered`);
    const randomBase = (ctor as any).randomize ? (ctor as any).randomize() : {};
    return new ctor(ctx, { ...randomBase, ...base });
  }

  static createWeighted(ctx: AudioContext, weights: Record<string, number>, base?: any): Voice {
    const entries = Object.entries(this.registry)
      .map(([name, ctor]) => ({ name, ctor, weight: Math.max(0, weights[name] ?? 0) }))
      .filter((entry) => entry.weight > 0);

    if (entries.length === 0) return this.createRandom(ctx, base);

    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let r = Math.random() * total;

    for (const entry of entries) {
      r -= entry.weight;
      if (r <= 0) {
        const randomBase = (entry.ctor as any).randomize ? (entry.ctor as any).randomize() : {};
        return new entry.ctor(ctx, { ...randomBase, ...base });
      }
    }

    const fallback = entries[entries.length - 1];
    const randomBase = (fallback.ctor as any).randomize ? (fallback.ctor as any).randomize() : {};
    return new fallback.ctor(ctx, { ...randomBase, ...base });
  }
}
