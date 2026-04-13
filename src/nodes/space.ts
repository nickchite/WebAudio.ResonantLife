import { AR_TICK_SIZE, Node } from './node';
import { Comb, AllPass } from './misc.ts';
import { Random } from '../lib.ts';

import * as Tone from 'tone';

export abstract class Space extends Node {
  constructor(ctx: AudioContext, base?: any) { super(ctx, base); }
}

export class FullSpace extends Space {
  reverb: Tone.Reverb;
  eq: Tone.EQ3;
  filter: Tone.Filter;
  panner: Tone.Panner;
  dryGain: Tone.Gain;
  wetGain: Tone.Gain;
  outputGain: Tone.Gain;

  constructor(ctx: AudioContext, base?: any) {
    super(ctx, base);

    this.base = {
      reverbTime: 2.5,
      eq: [0, 0, 0],
      filterFreq: 2500,
      pannerPos: 0,
      dry: 1,
      wet: 0.35,
      output: 1.2,
      ...this.base,
    };

    this.reverb = new Tone.Reverb(3);
    this.eq = new Tone.EQ3(this.base.eq[0], this.base.eq[1], this.base.eq[2]);
    this.filter = new Tone.Filter(this.base.filterFreq, "lowpass").connect(this.eq);
    this.panner = new Tone.Panner(this.base.pannerPos).connect(this.filter);

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
    this.base = {
      reverbTime: Random.uniform().linlin(0, 1, 1, 5).sample(),
      eq: [Random.uniform().linlin(0, 1, -6, 6).sample(), Random.uniform().linlin(0, 1, -6, 6).sample(), Random.uniform().linlin(0, 1, -6, 6).sample()],
      filterFreq: Random.uniform().linlin(0, 1, 1200, 5000).sample(),
      pannerPos: Random.uniform().linlin(0, 1, -1, 1).sample(),
      dry: Random.uniform().linlin(0, 1, 0.8, 1.2).sample(),
      wet: Random.uniform().linlin(0, 1, 0.2, 0.6).sample(),
      output: Random.uniform().linlin(0, 1, 1, 1.5).sample(),
    }
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
      pannerPos: {
        object: this.panner.pan,
        update_fn: this.panner.pan.linearRampToValueAtTime,
        args: [this.base.pannerPos, this.ctx.currentTime + AR_TICK_SIZE],
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
    const space = new FullSpace(ctx, base);
    space.base = {
      reverbTime: Random.uniform().linlin(0, 1, 1, 5).sample(),
      filterFreq: Random.uniform().linlin(0, 1, 1200, 5000).sample(),
      pannerPos: Random.uniform().linlin(0, 1, -1, 1).sample(),
      eq: [Random.uniform().linlin(0, 1, -6, 6).sample(), Random.uniform().linlin(0, 1, -6, 6).sample(), Random.uniform().linlin(0, 1, -6, 6).sample()],
      dry: Random.uniform().linlin(0, 1, 0.8, 1.2).sample(),
      wet: Random.uniform().linlin(0, 1, 0.2, 0.6).sample(),
      output: Random.uniform().linlin(0, 1, 1, 1.5).sample(),
    }
    return space;
  }
}