import { Random } from "../lib";

type Formant = { freq: number, Q: number };

type SawType = 'male' | 'female';

const formant_freq_ranges = {
    'male': [80, 200],
    'female': [220, 400], 
}

export function rand_type(): SawType {
    return ['male', 'female'][Math.floor(Math.random() * 2)] as SawType;
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


