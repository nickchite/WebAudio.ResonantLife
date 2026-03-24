import { Node } from './node';
import { ADSR } from './misc';

export class Voice extends Node {
  osc: OscillatorNode;
  gain: GainNode;
  adsr: ADSR;
  
  constructor(ctx: AudioContext, base: any) {
    super(ctx, base);
    this.osc = new OscillatorNode(ctx);
    this.gain = new GainNode(ctx);
    this.adsr = new ADSR(ctx, 0.01, 0.1, 0.8, 0.5);
    
    this.osc.connect(this.adsr.input());
    this.adsr.output().connect(this.gain);
    
    this.osc.frequency.value = base.frequency;
    this.gain.gain.value = 0;
    
    this.osc.start();
  }
  
  update(delta?: any) { 
    if (this.ctx.currentTime > this.nextTick) {
      super.update(delta);
      this.osc.frequency.setValueAtTime(this.base.frequency * delta.freq, this.nextTick);
      this.gain.gain.setValueAtTime(this.base.gain * delta.gain, this.nextTick);
      this.adsr.trig();
    }
  }
  
  input() { return undefined; }
  output() { return this.gain; }
}

export class FormantVoice extends Node {
  osc: OscillatorNode;
  gain: GainNode;
  filters: BiquadFilterNode[];

  constructor(ctx: AudioContext, formants: number[]) {
    super(ctx);
    this.osc = new OscillatorNode(ctx);
    this.osc.type = "sawtooth";
    this.osc.frequency.value = 600;
    this.osc.start();

    this.gain = new GainNode(ctx);
    //this.gain.gain.value = randGain() / Math.sqrt(N);
    this.gain.gain.value = 1;

    this.filters = formants.map((f) => {
      const filter = new BiquadFilterNode(ctx, { type: "bandpass", frequency: f, Q: 10 });
      this.osc.connect(filter).connect(this.gain);
      return filter;
    });
  }

  input() { return undefined; }
  output() { return this.gain; }
}


