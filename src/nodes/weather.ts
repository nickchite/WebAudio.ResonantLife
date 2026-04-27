import * as Tone from 'tone';

export class Weather {
  ctx: AudioContext;
  phaser: Tone.Phaser;
  delay: Tone.FeedbackDelay;
  chorus: Tone.Chorus;
  flanger: Tone.FeedbackDelay; // Flanger can be simulated with short delay
  gain: Tone.Gain;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.phaser = new Tone.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 350 });
    this.delay = new Tone.FeedbackDelay({ delayTime: 0.18, feedback: 0.4 });
    this.chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7 });
    this.flanger = new Tone.FeedbackDelay({ delayTime: 0.005, feedback: 0.3 });
    this.gain = new Tone.Gain(1);

    // FX chain: input -> [phaser -> delay -> chorus -> flanger] -> wetGain -> output
    this.phaser.connect(this.delay);
    this.delay.connect(this.chorus);
    this.chorus.connect(this.flanger);
    this.flanger.connect(this.gain);
  }

  dispose() {
    this.phaser.dispose();
    this.delay.dispose();
    this.chorus.dispose();
    this.flanger.dispose();
    this.gain.dispose();
  }
  
  input() { return this.phaser; }
  output() { return this.gain; }
}
