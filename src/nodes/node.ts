export const AR_TICK_SIZE = 0.020;

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
    this.fanGain = ctx.createGain();
    this.fanGain.gain.value = 1;
  }

  connect(destination: Node): Node {
    this.output()?.connect(destination.input());
    destination.fanGain.gain.value = 1 / ++destination.fanIn;
    return destination;
  }

  disconnect(destination: Node): void {
    this.output()?.disconnect(destination.fanGain);
    destination.fanGain.gain.value = 1 / Math.max(1, --destination.fanIn);
    return undefined;
  }
  
  update(delta: { time: number, [param: string]: any }) {
    if (this.ctx.currentTime > this.nextTick) {
      this.nextTick = this.ctx.currentTime + delta.time;
        Object.entries(this.updaters(delta) ?? {}).forEach(([_, { object: param, update_fn, args }]) => { update_fn.apply(param, args); });
    }
  }
  
  abstract updaters(delta?: { [param: string]: any }): Record<string, { object: Object, update_fn: Function, args: number[] }> | undefined;
  
  abstract input(): AudioNode | undefined;
  abstract output(): AudioNode | undefined;
}
