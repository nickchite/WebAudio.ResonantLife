export const DENSITY_MIN_BPM = 0;
export const DENSITY_MAX_BPM = 300;
export const DENSITY_FOCUS_BPM = 120;
export const DENSITY_FOCUS_SLIDER = 0.72;
export const DENSITY_HIGH_CURVE = 1.25;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function densityFromBpm(bpm: number): number {
  const b = Math.min(DENSITY_MAX_BPM, Math.max(DENSITY_MIN_BPM, bpm));

  if (b <= DENSITY_FOCUS_BPM) {
    const tLow = (b - DENSITY_MIN_BPM) / (DENSITY_FOCUS_BPM - DENSITY_MIN_BPM);
    return DENSITY_FOCUS_SLIDER * tLow;
  }

  const tHigh = (b - DENSITY_FOCUS_BPM) / (DENSITY_MAX_BPM - DENSITY_FOCUS_BPM);
  return DENSITY_FOCUS_SLIDER + (1 - DENSITY_FOCUS_SLIDER) * Math.pow(tHigh, 1 / DENSITY_HIGH_CURVE);
}

export function bpmFromDensity(density: number): number {
  const d = clamp01(density);

  if (d <= DENSITY_FOCUS_SLIDER) {
    const tLow = d / DENSITY_FOCUS_SLIDER;
    return lerp(DENSITY_MIN_BPM, DENSITY_FOCUS_BPM, tLow);
  }

  const tHigh = (d - DENSITY_FOCUS_SLIDER) / (1 - DENSITY_FOCUS_SLIDER);
  return lerp(DENSITY_FOCUS_BPM, DENSITY_MAX_BPM, Math.pow(tHigh, DENSITY_HIGH_CURVE));
}