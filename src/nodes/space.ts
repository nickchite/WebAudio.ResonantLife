import { AR_TICK_SIZE, Node } from './node';
import { Comb, AllPass } from './misc.ts';
import { Random } from '../lib.ts';

export abstract class Space extends Node {
  constructor(ctx: AudioContext, base?: any) { super(ctx, base); }
}

export class EmptySpace extends Space {
  gain: GainNode;

  constructor(ctx: AudioContext, base?: any) {
    super(ctx, base);
    this.gain = new GainNode(ctx, { gain: 1 });
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
    this.delay = new DelayNode(ctx, { maxDelayTime: 3 });
    this.feedback = new GainNode(ctx, { gain: 0.8 });
    this.feedforward = new GainNode(ctx, { gain: 0 });
    
    if (!this.base) this.base = {
      delayTime: 0.5,
      fb: 0.8,
    };

    this.delay.delayTime.value = this.base.delayTime;
    
    this.fanGain.connect(this.delay);
    this.delay.connect(this.feedback).connect(this.delay);
    this.delay.connect(this.feedforward);
  }
  
  on_update(delta?: any) {
    const now = this.ctx.currentTime;
    // this.delay.delayTime.exponentialRampToValueAtTime(this.base.delayTime * delta.dt, now + AR_TICK_SIZE);
    // this.delay.delayTime.exponentialRampToValueAtTime(this.base.fb * delta.fb, now + AR_TICK_SIZE);
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
    
    if (!this.base) this.base = {
      combDelays: [0.03, 0.04, 0.05, 0.06],
      allPassDelays: [0.01, 0.01],
      decay: 0.8,
      wet: 0.5,
      dry: 0.5,
    };

    const numCombs = this.base.combDelays?.length;
    const numAllPasses = this.base.allPassDelays?.length;
    const decay = this.base.decay;

    this.outputNode = new GainNode(ctx);
    this.wetGain = new GainNode(ctx, { gain: this.base.wet });
    this.dryGain = new GainNode(ctx, { gain: this.base.dry });

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

type SpaceConstructor = new (ctx: AudioContext, base?: any) => Space;

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
}
