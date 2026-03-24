export abstract class Node {
  ctx: AudioContext;
  nextTick: number;
  base: any;
  fanIn: number = 0;
  fanGain: GainNode;
  
  constructor(ctx: AudioContext, base?: any) { 
    this.ctx = ctx;
    this.nextTick = this.ctx.currentTime;
    this.base = base;
    this.fanGain = new GainNode(ctx, { gain: 1 });
  }

  connect(destination: Node): Node {
    this.output().connect(destination.input());
    destination.fanGain.gain.value = 1 / ++destination.fanIn;
    return destination;
  }

  disconnect(destination: Node): void {
    this.output().disconnect(destination.fanGain);
    destination.fanGain.gain.value = 1 / Math.max(1, --destination.fanIn);
    return undefined;
  }
  
  update(delta?: any) {
    this.nextTick = this.ctx.currentTime + delta.time;
  }
  
  abstract input(): AudioNode;
  abstract output(): AudioNode;
}
