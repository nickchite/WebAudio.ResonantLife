import { Node } from './node';
import { Comb, AllPass } from './misc.ts';

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
      this.delay.delayTime.exponentialRampToValueAtTime(this.base.delayTime * delta.dt, this.nextTick);
      this.delay.delayTime.exponentialRampToValueAtTime(this.base.fb * delta.fb, this.nextTick);
    }
  }
  
  input() { return this.fanGain; }
  output() { return this.delay; }
}

export class ReverbSpace extends Node {
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

    const numCombs = base.combDelays?.length ?? 4;
    const numAllPasses = base.allPassDelays?.length ?? 2;
    const decay = base.decay ?? 0.8;

    this.outputNode = new GainNode(ctx);
    this.wetGain = new GainNode(ctx, { gain: base.wet ?? 0.5 });
    this.dryGain = new GainNode(ctx, { gain: base.dry ?? 0.5 });

    this.combs = [];
    for (let i = 0; i < numCombs; i++) {
      const delayTime = base.combDelays?.[i] ?? (0.03 + i * 0.01);
      const comb = new Comb(ctx, delayTime, decay);
      this.combs.push(comb);
      this.fanGain.connect(comb.input());
      comb.output().connect(this.wetGain);
    }

    this.allpasses = [];
    let previousNode: AudioNode = this.wetGain;
    for (let i = 0; i < numAllPasses; i++) {
      const delayTime = base.allPassDelays?.[i] ?? 0.01;
      const allPass = new AllPass(ctx, delayTime, decay);
      previousNode.connect(allPass.input());
      previousNode = allPass.output();
      this.allpasses.push(allPass);
    }

    previousNode.connect(this.outputNode);
    this.fanGain.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);
  }

  input(): AudioNode { return this.fanGain; }
  output(): AudioNode { return this.outputNode; }
  
  update(delta?: any) {
    if (this.ctx.currentTime > this.nextTick) {
      super.update(delta);
    }
  }

  setWetDry(wet: number, dry: number) {
    this.wetGain.gain.value = wet;
    this.dryGain.gain.value = dry;
  }

  setDecay(value: number) {
    this.combs.forEach(c => c.setDecay(value));
    this.allpasses.forEach(ap => ap.setFeedback(value));
  }
}
