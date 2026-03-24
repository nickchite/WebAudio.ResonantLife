import { Node } from './node';

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
