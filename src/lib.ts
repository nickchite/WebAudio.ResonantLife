export class Random {
  static linlin(inMin: number, inMax: number, outMin: number, outMax: number) {
    return linlin(Math.random(), inMin, inMax, outMin, outMax);
  }
  
  static linexp(inMin: number, inMax: number, outMin: number, outMax: number) {
    return linexp(Math.random(), inMin, inMax, outMin, outMax);
  }

  static normal(mean = 0, std = 1) {
    const u1 = Math.random();
    const u2 = Math.random();

    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    return z0 * std + mean;
  }
  
  static rgb() {
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    return `rgb(${r}, ${g}, ${b})`;
  }
  
  static exponential(lambda: number) {
    return -Math.log(1 - Math.random()) / lambda;
  }
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
