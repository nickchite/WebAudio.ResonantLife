declare module 'jstat' {
  export const normal: {
    sample(mean?: number, std?: number): number;
  };

  export const gamma: {
    sample(shape: number, scale: number): number;
  };
}
