import * as jstat from 'jstat';

type Transform = (x: number, ...args: any[]) => number;
type Distribution = (...args: any[]) => number;
type Tail<T extends unknown[]> = T extends [any, ...infer Rest] ? Rest : never;

const typedEntries = <T extends Record<string, unknown>>(obj: T) =>
  Object.entries(obj) as { [K in keyof T]: [K, T[K]] }[keyof T][];

class RandomCore {
  private base: () => number;
  private transforms: Transform[] = [];
  private static registry: Record<string, Transform | Distribution> = {};
  
  private constructor(base: () => number) { this.base = base; }

  map(transform: Transform, ...args: any[]): this {
    this.transforms.push((x: number) => transform(x, ...args));
    return this;
  }
  
  static register_distribution(name: string, fn: Distribution) {
    if (this.registry[name]) throw new Error(`Transformer ${name} already registered`);

    this.registry[name] = fn;

    Object.defineProperty(this, name, {
      value: (...args: any[]) => new RandomCore(() => fn(...args)),
      writable: false,
    });
  } 
  
  static register_transform(name: string, fn: Transform) {
    if (this.registry[name]) throw new Error(`Transformer ${name} already registered`);

    this.registry[name] = fn;

    Object.defineProperty(this.prototype, name, {
      value: function (this: RandomCore, ...args: any[]) {
        return this.map(fn, ...args);
      },
      writable: false,
    });
  } 
  
  sample() { return this.transforms.reduce((acc, transform) => transform(acc), this.base()); }
}

const distributions = {
  uniform: Math.random,
  normal,
  exponential,
  gamma,
  gamma_tempo,
} as const satisfies Record<string, Distribution>;

const transformers = {
  linlin,
  linexp,
  floor: Math.floor,
  min: Math.min,
  max: Math.max,
  clamp,
} as const satisfies Record<string, Transform>;

export type Random = RandomCore & {
  [K in keyof typeof transformers]: (...args: Tail<Parameters<(typeof transformers)[K]>>) => Random;
};

type RandomConstructor = typeof RandomCore & {
  [K in keyof typeof distributions]: (...args: Parameters<(typeof distributions)[K]>) => Random;
};

export const Random = RandomCore as RandomConstructor;

typedEntries(distributions).forEach(([name, fn]) => { Random.register_distribution(name, fn); });
typedEntries(transformers).forEach(([name, fn]) => { Random.register_transform(name, fn); });

function normal(mean = 0, std = 1) {
  return jstat.normal.sample(mean, std);
}

function exponential(lambda: number) {
  return -Math.log(1 - Math.random()) / lambda;
}

function gamma(shape: number, scale: number) {
  return jstat.gamma.sample(shape, scale);
}

function gamma_tempo(tempo: number, shape: number) {
  const u = 60 / tempo;
  const scale = u / shape;
  return jstat.gamma.sample(shape, scale);
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
