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

  private rampFanGain(destination: Node, rampTime = 0.1) {
    const g = destination.fanGain.gain;
    const target = 1 / Math.max(1, destination.fanIn);
    const now = this.ctx.currentTime;
    g.setValueAtTime(g.value, now);
    g.exponentialRampToValueAtTime(target, now + rampTime);
  }

  connect(destination: Node, rampTime = 0.1): Node {
    const source = this.output();
    const target = destination.input();
    if (source && target) {
      Tone.connect(source as any, target as any);
    }
    ++destination.fanIn;
    this.rampFanGain(destination, rampTime);
    return destination;
  }

  disconnect(destination: Node, rampTime = 0.1): void {
    const source = this.output();
    const target = destination.input();
    if (source && target) {
      Tone.disconnect(source as any, target as any);
    }
    destination.fanIn = Math.max(0, --destination.fanIn);
    this.rampFanGain(destination, rampTime);
    return undefined;
  }
  
  update(delta: { time: number, [param: string]: any }) {
    if (this.ctx.currentTime > this.nextTick) {
      this.nextTick = this.ctx.currentTime + delta.time;
        Object.entries(this.updaters(delta) ?? {}).forEach(([_, { object: param, update_fn, args }]) => { update_fn.apply(param, args); });
    }
  }
  
  abstract updaters(delta?: { [param: string]: any }): Record<string, { object: Object, update_fn: Function, args: number[] }> | undefined;

  // Override in subclasses to release external resources like oscillators.
  dispose() {
    try {
      this.fanGain.disconnect();
    } catch {
      // no-op
    }
  }
  
  abstract input(): any;
  abstract output(): any;
}
