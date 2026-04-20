export const ROOT_MOTION_PROFILES = {
  lowVariance: {
    clockMinBpm: 3,
    clockMaxBpm: 24,
    densityExponent: 0.65,
    clockMinIntervalSec: 0.45,
    clockMaxIntervalSec: 16,
    shapeLo: 6,
    shapeHi: 18,
    harmonicitySteepness: 10,
    offSpreadSemisLow: 8,
    offSpreadSemisHigh: 0.25,
  },
  balanced: {
    clockMinBpm: 4,
    clockMaxBpm: 36,
    densityExponent: 0.72,
    clockMinIntervalSec: 0.35,
    clockMaxIntervalSec: 12,
    shapeLo: 4,
    shapeHi: 14,
    harmonicitySteepness: 9,
    offSpreadSemisLow: 12,
    offSpreadSemisHigh: 0.5,
  },
  highVariance: {
    clockMinBpm: 6,
    clockMaxBpm: 60,
    densityExponent: 0.85,
    clockMinIntervalSec: 0.25,
    clockMaxIntervalSec: 8,
    shapeLo: 2.5,
    shapeHi: 10,
    harmonicitySteepness: 7,
    offSpreadSemisLow: 14,
    offSpreadSemisHigh: 2,
  },
};

export const ACTIVE_ROOT_MOTION_PROFILE = 'balanced';
export const ROOT_MOTION = ROOT_MOTION_PROFILES[ACTIVE_ROOT_MOTION_PROFILE];