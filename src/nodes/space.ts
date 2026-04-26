import { AR_TICK_SIZE, Node } from './node';
import { Comb, AllPass } from './misc.ts';

import * as Tone from 'tone';

export abstract class Space extends Node {
  constructor(ctx: AudioContext, base?: any) { super(ctx, base); }

  dispose() {
    super.dispose();
  }
}

export class FullSpace extends Space {
  reverb: Tone.Reverb;
  eq: Tone.EQ3;
  filter: Tone.Filter;
  panner: Tone.Panner3D;
  dryGain: Tone.Gain;
  wetGain: Tone.Gain;
  outputGain: Tone.Gain;

  constructor(ctx: AudioContext, base?: any) {
    super(ctx, base);

    this.base = {
      reverbTime: 2.5,
      eq: [0, 0, 0],
      filterFreq: 2500,
      pannerX: 0,
      pannerZ: -1,  // -1 = directly in front, +1 = directly behind
      dry: 0.55,
      wet: 0.85,
      output: 1.2,
      ...this.base,
    };

    this.reverb = new Tone.Reverb(3);
    this.eq = new Tone.EQ3(this.base.eq[0], this.base.eq[1], this.base.eq[2]);
    this.filter = new Tone.Filter(this.base.filterFreq, "lowpass").connect(this.eq);
    this.panner = new Tone.Panner3D({
      panningModel: 'HRTF',
      positionX: this.base.pannerX,
      positionY: 0,
      positionZ: this.base.pannerZ,
      rolloffFactor: 0,
    }).connect(this.filter);

    this.dryGain = new Tone.Gain(this.base.dry);
    this.wetGain = new Tone.Gain(this.base.wet);
    this.outputGain = new Tone.Gain(this.base.output);

    this.eq.connect(this.dryGain);
    this.eq.connect(this.reverb);
    this.reverb.connect(this.wetGain);

    this.dryGain.connect(this.outputGain);
    this.wetGain.connect(this.outputGain);
  }
  
  randomize() {
    // Continuous axes — each space is a unique point in character space
    const wetness   = Math.random();           // 0 = tight/dry,   1 = vast/drenched
    const brightness = Math.random();          // 0 = dark/filtered, 1 = airy/open
    const midPush   = Math.random() * 2 - 1;  // -1 = scooped,     +1 = middy/honky

    // Reverb time: exponential 0.4 → 18s driven by wetness
    const reverbTime = 0.4 * Math.pow(45, wetness);

    // Wet/dry correlated with wetness
    const wet = 0.3  + wetness * 1.6;          // 0.30 – 1.90
    const dry = 0.85 - wetness * 0.75;         // 0.85 – 0.10

    // Filter: log-spaced 350 → 18000 Hz, mostly driven by brightness
    const filterFreq = 350 * Math.pow(51.4, brightness * 0.75 + Math.random() * 0.25);

    // EQ: independent wide-range variation, high band biased by brightness
    const eqLow  = (Math.random() * 2 - 1) * 18;
    const eqMid  = midPush * 13 + (Math.random() * 2 - 1) * 5;
    const eqHigh = (brightness - 0.5) * 30 + (Math.random() * 2 - 1) * 8;

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    this.base = {
      reverbTime,
      eq: [clamp(eqLow, -20, 16), clamp(eqMid, -18, 18), clamp(eqHigh, -20, 20)],
      filterFreq,
      pannerX: 0,    // overwritten by engine at creation time
      pannerZ: -0.866,
      dry,
      wet,
      output: 0.85 + Math.random() * 0.55,
    };
    return this;
  }
  
  updaters() { return {
      reverbTime: {
        object: this.reverb,
        update_fn: this.reverb.set,
        args: [this.base.reverbTime],
      },
      eq: {
        object: this.eq,
        update_fn: this.eq.set,
        args: [this.base.eq[0], this.base.eq[1], this.base.eq[2]],
      },
      filterFreq: {
        object: this.filter.frequency,
        update_fn: this.filter.frequency.exponentialRampToValueAtTime,
        args: [this.base.filterFreq, this.ctx.currentTime + AR_TICK_SIZE],
      },
      pannerX: {
        object: this.panner.positionX,
        update_fn: this.panner.positionX.linearRampToValueAtTime,
        args: [this.base.pannerX, this.ctx.currentTime + AR_TICK_SIZE],
      },
      pannerZ: {
        object: this.panner.positionZ,
        update_fn: this.panner.positionZ.linearRampToValueAtTime,
        args: [this.base.pannerZ, this.ctx.currentTime + AR_TICK_SIZE],
      },
      dry: {
        object: this.dryGain.gain,
        update_fn: this.dryGain.gain.linearRampToValueAtTime,
        args: [this.base.dry, this.ctx.currentTime + AR_TICK_SIZE],
      },
      wet: {
        object: this.wetGain.gain,
        update_fn: this.wetGain.gain.linearRampToValueAtTime,
        args: [this.base.wet, this.ctx.currentTime + AR_TICK_SIZE],
      },
      output: {
        object: this.outputGain.gain,
        update_fn: this.outputGain.gain.linearRampToValueAtTime,
        args: [this.base.output, this.ctx.currentTime + AR_TICK_SIZE],
      }
    };
  }
  
  input() { return this.panner; }
  output() { return this.outputGain; }

  dispose() {
    try { this.panner.disconnect(); } catch {}
    try { this.filter.disconnect(); } catch {}
    try { this.eq.disconnect(); } catch {}
    try { this.reverb.disconnect(); } catch {}
    try { this.dryGain.disconnect(); } catch {}
    try { this.wetGain.disconnect(); } catch {}
    try { this.outputGain.disconnect(); } catch {}
    super.dispose();
  }
}

export class EmptySpace extends Space {
  gain: GainNode;

  constructor(ctx: AudioContext, base?: any) {
    super(ctx, base);
    this.gain = ctx.createGain();
    this.gain.gain.value = 1;
  }
  
  updaters() { return undefined }
  
  input() { return this.gain }
  output() { return this.gain }

  dispose() {
    try { this.gain.disconnect(); } catch {}
    super.dispose();
  }
}

export class DelaySpace extends Space {
  delay: DelayNode;
  feedback: GainNode; 
  feedforward: GainNode;
  
  constructor(ctx: AudioContext, base?: any) {
    super(ctx, base);
    this.delay = ctx.createDelay(3);
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.8;
    this.feedforward = ctx.createGain();
    this.feedforward.gain.value = 0;
    
    if (!this.base) this.base = {
      delayTime: 0.5,
      fb: 0.8,
    };

    this.delay.delayTime.value = this.base.delayTime;
    
    this.fanGain.connect(this.delay);
    this.delay.connect(this.feedback).connect(this.delay);
    this.delay.connect(this.feedforward);
  }
  
  updaters(delta?: any) {
    return {
      delayTime: {
        object: this.delay.delayTime,
        update_fn: this.delay.delayTime.exponentialRampToValueAtTime,
        args: [this.base.delayTime * (delta?.dt ?? 1), this.ctx.currentTime + AR_TICK_SIZE],
      },
      fb: {
        object: this.feedback.gain,
        update_fn: this.feedback.gain.exponentialRampToValueAtTime,
        args: [this.base.fb * (delta?.fb ?? 1), this.ctx.currentTime + AR_TICK_SIZE],
      }
    };
  }
  
  input() { return this.fanGain; }
  output() { return this.delay; }

  dispose() {
    try { this.delay.disconnect(); } catch {}
    try { this.feedback.disconnect(); } catch {}
    try { this.feedforward.disconnect(); } catch {}
    super.dispose();
  }
}

export class ReverbSpace extends Space {
  combs: Comb[];
  allpasses: AllPass[];
  outputNode: GainNode;
  wetGain: GainNode;
  dryGain: GainNode;

  constructor(ctx: AudioContext, base: {
    combDelays?: number[];
    allPassDelays?: number[];
    decay?: number;
    wet?: number;
    dry?: number;
  } = {}) {
    super(ctx, base);
    
    // TODO: if !base ?
    this.base = {
      combDelays: [0.03, 0.04, 0.05, 0.06],
      allPassDelays: [0.01, 0.01],
      decay: 0.8,
      wet: 0.5,
      dry: 0.5,
    };

    const numCombs = this.base.combDelays?.length;
    const numAllPasses = this.base.allPassDelays?.length;
    const decay = this.base.decay;

    this.outputNode = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = this.base.wet;
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = this.base.dry;

    this.combs = [];
    for (let i = 0; i < numCombs; i++) {
      const delayTime = this.base.combDelays[i];
      const comb = new Comb(ctx, delayTime, decay);
      this.combs.push(comb);
      this.fanGain.connect(comb.input());
      comb.output().connect(this.wetGain);
    }

    this.allpasses = [];
    let previousNode: AudioNode = this.wetGain;
    for (let i = 0; i < numAllPasses; i++) {
      const delayTime = this.base.allPassDelays[i];
      const allPass = new AllPass(ctx, delayTime, decay);
      previousNode.connect(allPass.input());
      previousNode = allPass.output();
      this.allpasses.push(allPass);
    }

    previousNode.connect(this.outputNode);
    this.fanGain.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);
  }
  
  updaters() { return undefined }

  input(): AudioNode { return this.fanGain; }
  output(): AudioNode { return this.outputNode; }

  dispose() {
    this.combs.forEach((comb) => {
      try { comb.input().disconnect(); } catch {}
      try { comb.output().disconnect(); } catch {}
    });

    this.allpasses.forEach((allPass) => {
      try { allPass.input().disconnect(); } catch {}
      try { allPass.output().disconnect(); } catch {}
    });

    try { this.wetGain.disconnect(); } catch {}
    try { this.dryGain.disconnect(); } catch {}
    try { this.outputNode.disconnect(); } catch {}
    super.dispose();
  }
}

/* type SpaceConstructor = new (ctx: AudioContext, base?: any) => Space;

export class SpaceFactory {
  static registry: Record<string, SpaceConstructor> = {
    "empty": EmptySpace,
    "delay": DelaySpace,
    "reverb": ReverbSpace,
  };
  
  static register(name: string, ctor: SpaceConstructor) {
    if (this.registry.hasOwnProperty(name)) throw new Error(`Space ${name} already registered`);
    this.registry[name] = ctor;
    console.log(`Registered space: ${name}`, ctor);
  }

  static createRandom(ctx: AudioContext, base?: any): Space {
    const constructors = Object.values(this.registry);
    if (constructors.length === 0) throw new Error("No spaces registered");
    const ctor = constructors[Random.uniform().linlin(0, 1, 0, constructors.length).floor().sample()];
    return new ctor(ctx, base);
  }
} */

export class SpaceFactory {
  static create(ctx: AudioContext, base?: any): FullSpace {
    return new FullSpace(ctx, base);
  }
}