export const AR_TICK_SIZE = 0.020;

import * as Tone from 'tone';

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
    const source = this.output();
    const target = destination.input();
    if (source && target) {
      Tone.connect(source as any, target as any);
    }
    destination.fanGain.gain.value = 1 / ++destination.fanIn;
    return destination;
  }

  disconnect(destination: Node): void {
    const source = this.output();
    const target = destination.input();
    if (source && target) {
      Tone.disconnect(source as any, target as any);
    }
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
  
  abstract input(): any;
  abstract output(): any;
}
