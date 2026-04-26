import { Random } from "../lib";

type Formant = { freq: number, Q: number };

type SawType = 'male' | 'female' | 'buzzy';

const formant_freq_ranges = {
    'male': [80, 200],
    'female': [220, 400], 
    'buzzy': [400, 800], 
}

export function rand_type(): SawType {
    const keys = Object.keys(formant_freq_ranges) as SawType[];
    return keys[Math.floor(Math.random() * keys.length)];
}

export function rand_freq(type: SawType): number {
    const range = formant_freq_ranges[type];
    return Random.uniform().linexp(0, 1, range[0], range[1]).sample();
}

function generate_formant_ratios() {
    const F1 = Random.uniform().linexp(0, 1, 0.9, 1.2).sample();
    const F2 = F1 * Random.uniform().linexp(0, 1, 1.6, 2.1).sample();
    const F3 = F2 * Random.uniform().linexp(0, 1, 1.4, 1.8).sample();
    return [F1, F2, F3];
}

export function random_formant_modulation_ratios(
    count: number,
    spread: number,
    options: {
        colorMin?: number,
        colorMax?: number,
        colorStep?: number,
    } = {}
): number[] {
    const {
        colorMin = 1,
        colorMax = 1,
        colorStep = 0,
    } = options;

    return Array.from({ length: count }, (_, i) => {
        const base = Random.uniform().linexp(0, 1, 1 / spread, spread).sample();
        const colorHi = colorMax + (i * colorStep);
        const color = Random.uniform().linexp(0, 1, colorMin, colorHi).sample();
        return base * color;
    });
}

export function random_formants(type: SawType): Formant[] {
    const freq_range = formant_freq_ranges[type];
    const formant_ratios = generate_formant_ratios();
    const formants: Formant[] = formant_ratios.map(ratio => {
        const freq = Random.uniform().linexp(0, 1, freq_range[0], freq_range[1]).sample() * ratio;
        const Q = Random.uniform().linexp(0, 1, 2, 20).sample();
        return { freq, Q };
    });
    
    return formants;
}


