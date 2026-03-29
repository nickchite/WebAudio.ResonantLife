import * as jstat from 'jstat';

type Transform = (x: number, ...args: any[]) => number;
type Distribution = (...args: any[]) => number;

export class Random {
  private base: () => number;
  private transforms: Transform[] = [];
  private static registry: Record<string, Transform> = {};
  
  private constructor(base: () => number) { this.base = base; }

  map(transform: Transform, ...args: any[]) {
    this.transforms.push((x: number) => transform(x, ...args));
    return this;
  }
  
   static register_distribution(fn: Distribution, alias?: string) {
    const name = alias || fn.name;
    if (this.registry[name]) throw new Error(`Transformer ${name} already registered`);

    this.registry[name] = fn;

    Object.defineProperty(Random, name, {
      value: function (...args: any[]) {
        return new Random(() => fn(...args));
      },
      writable: false,
    });
    
    console.log(`Registered distribution: ${name}`, fn);
  } 
  
  static register_transform(fn: Transform, alias?: string) {
    const name = alias || fn.name;
    if (this.registry[name]) throw new Error(`Transformer ${name} already registered`);

    this.registry[name] = fn;

    Object.defineProperty(Random.prototype, name, {
      value: function (...args: any[]) {
        return this.map(fn, ...args);
      },
      writable: false,
    });
    
    console.log(`Registered transformer: ${name}`, fn);
  } 
  
  sample() { return this.transforms.reduce((acc, transform) => transform(acc), this.base()); }
  
  // TODO: refactor
  static rgb() {
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

const distributions: { fn: Distribution; alias?: string }[] = [
  { fn: Math.random, alias: 'uniform' },
  { fn: normal },
  { fn: exponential },
];
distributions.forEach((distribution) => { Random.register_distribution(distribution.fn, distribution.alias); });

const transformers: { fn: Transform; alias?: string }[] = [
  { fn: linlin },
  { fn: linexp },
  { fn: Math.floor },
  { fn: Math.min },
  { fn: Math.max },
  { fn: clamp },
];
transformers.forEach((transformer) => { Random.register_transform(transformer.fn, transformer.alias); });

function normal(mean = 0, std = 1) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z0 * std + mean;
}

function exponential(lambda: number) {
  return -Math.log(1 - Math.random()) / lambda;
}

/**
 * 
 * @param value input value
 * @param inMin input minimum
 * @param inMax input maximum
 * @param outMin output minimum
 * @param outMax output maximum
 * @returns value scaled from linear input min/max to linearoutput min/max
 */
export function linlin(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin + (outMax - outMin) * (value - inMin) / (inMax - inMin);
}

/**
 * 
 * @param value input value
 * @param inMin input minimum
 * @param inMax input maximum
 * @param outMin output minimum
 * @param outMax output maximum
 * @returns value scaled from linear input min/max to exponential output min/max
 */
export function linexp(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin * Math.pow(outMax / outMin, (value - inMin) / (inMax - inMin));
}

/**
 * 
 * @param value input value
 * @param inMin input minimum
 * @param inMax input maximum
 * @param outMin output minimum
 * @param outMax output maximum
 * @returns value scaled from exponential input min/max to exponential output min/max
 */
export function explin(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return inMin * Math.pow(inMax / inMin, (value - outMin) / (outMax - outMin));
}

/**
 * 
 * @param value input value
 * @param inMin input minimum
 * @param inMax input maximum
 * @param outMin output minimum
 * @param outMax output maximum
 * @returns value scaled from linear input min/max to exponential output min/max
 */
export function expexp(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin * Math.pow(outMax / outMin, (value - inMin) / (inMax - inMin));
}

/**
 * 
 * @param amp input in linear amplitude
 * @returns output in decibels
 */
export function amp_to_db(amp: number) { return 20 * Math.log10(amp); }

/**
 * 
 * @param db input in decibels
 * @returns output in linear amplitude
 */
export function db_to_amp(db: number) { return Math.pow(10, db / 20); }

/**
 * 
 * @param freq input frequency
 * @returns output in MIDI
 */
export function freq_to_midi(freq: number) { return 69 + 12 * Math.log2(freq / 440); }

/**
 * 
 * @param midi input in MIDI
 * @returns output in frequency
 */
export function midi_to_freq(midi: number) { return 440 * Math.pow(2, (midi - 69) / 12); }

export function clamp(x: number, min: number, max: number) {
    return Math.max(min, Math.min(max, x));
}

export function truncnorm(min: number, max: number) {
    const mean = (min + max) / 2;
    const std = (max - min) / 8;
    return clamp(jstat.normal.sample(mean, std), min, max);
}
