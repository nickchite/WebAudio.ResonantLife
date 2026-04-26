import { Random, linexp, quantize } from '../lib.ts';
import { Output } from '../nodes/misc.ts';
import { random_formant_modulation_ratios } from '../nodes/formant.ts';
import { FormantVoice, VoiceFactory } from '../nodes/voice.ts';
import { SpaceFactory } from '../nodes/space.ts';
import { ROOT_MOTION } from '../config/rootMotion.js';
import { bpmFromDensity, clamp01, DENSITY_MAX_BPM, lerp } from '../utils/controlMath.ts';
import { ref } from 'vue';

import * as Tone from 'tone';

const PITCH_COHERENCE_STEEPNESS = 12;
const HARMONIC_ROOT_FALLBACK_HZ = 55;
const HARMONIC_ROOT_MIN_HZ = 55;
const HARMONIC_ROOT_MAX_HZ = 110;
const HARMONIC_INDEX_POOL = [1, 2, 3, 4, 5, 6, 8];
const CONTROL_RATE = 100;
const CONTROL_TIME = 1000 / CONTROL_RATE;
const DEBUG_AUDIO_GRAPH = import.meta.env.DEV && import.meta.env.VITE_DEBUG_AUDIO_GRAPH === '1';

const LIFECYCLE_ENABLED = true;
const LIFECYCLE_MUTATION_CHANCE = 0.6;
const LIFECYCLE_RANDOM_CHANCE = 0.2;  // independent: chance any spawn is fully random
const LIFECYCLE_LIFESPAN_MIN_SEC = 8;
const LIFECYCLE_LIFESPAN_MAX_SEC = 50;
// Population above this per-type count compresses lifespans toward the minimum.
const LIFECYCLE_POP_PRESSURE_TARGET = 5;
const LIFECYCLE_POP_PRESSURE_MAX = 12;
const LIFECYCLE_SPAWN_INTERVAL_MIN_SEC = 3;
const LIFECYCLE_SPAWN_INTERVAL_MAX_SEC = 14;

const SCORE_EMA_ALPHA = 0.18;
const ANALYSER_FFT_SIZE = 512;
const BRIGHTNESS_SPLIT_HZ = 1800;

export function useResonantEngine(options) {
  const {
    flow,
  } = options;

  function createControl(initial = 0.5) {
    const coherence = ref(initial);
    const density = ref(initial);

    function setCoherence(value) { coherence.value = value; }
    function setDensity(value) { density.value = value; }
    function set(values = {}) {
      if (values.coherence !== undefined) setCoherence(values.coherence);
      if (values.density !== undefined) setDensity(values.density);
    }

    return {
      coherence,
      density,
      setCoherence,
      setDensity,
      set,
    };
  }

  const sine = createControl(0.5);
  const formant = createControl(0.5);

  const voices = [];
  const spaces = [];
  const suppressedEdgeAdds = new Set();
  const edgeKeys = new Set();
  const voiceStatsById = new Map();
  const voiceIdByNode = new WeakMap();
  const spacePositions = new Map();
  // Tracks which sides of each space are occupied: Map<spaceId, Set<'top'|'right'|'bottom'|'left'>>
  const spaceOccupiedSides = new Map();

  let ctx;
  let output;
  let updateInterval;
  let harmonicRootHz = HARMONIC_ROOT_FALLBACK_HZ;
  let nextRootChangeTime = 0;
  let nextVoiceId = 0;
  let nextSpaceId = 0;
  let nextSpawnTime = 0;
  let nextSpawnType = Math.random() < 0.5 ? 'sine' : 'formant';

  function debugLog(...args) {
    if (DEBUG_AUDIO_GRAPH) console.log(...args);
  }

  function debugTable(...args) {
    if (DEBUG_AUDIO_GRAPH) console.table(...args);
  }

  function sigmoid01(value, steepness = 8) {
    const x = clamp01(value);
    const s = Math.max(1e-6, steepness);
    const edgeLow = 1 / (1 + Math.exp(s / 2));
    const edgeHigh = 1 / (1 + Math.exp(-s / 2));
    const y = 1 / (1 + Math.exp(-s * (x - 0.5)));
    return clamp01((y - edgeLow) / (edgeHigh - edgeLow));
  }

  function safeGainValue(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : value;
  }

  function inspectLevels(node) {
    if (!node) return {};
    return {
      type: node.constructor?.name,
      fanGain: safeGainValue(node.fanGain?.gain?.value),
      gain: safeGainValue(node.gain?.gain?.value),
      master: safeGainValue(node.master?.gain?.value),
      dry: safeGainValue(node.dryGain?.gain?.value),
      wet: safeGainValue(node.wetGain?.gain?.value),
      output: safeGainValue(node.outputGain?.gain?.value),
      eqLow: safeGainValue(node.eq?.low?.value),
      eqMid: safeGainValue(node.eq?.mid?.value),
      eqHigh: safeGainValue(node.eq?.high?.value),
      filterFreq: safeGainValue(node.filter?.frequency?.value),
    };
  }

  function coherenceStepSize(coherence, harmonicStep = 100, minStep = 0.25) {
    const c = Math.min(1, Math.max(0, coherence));
    const ratio = minStep / harmonicStep;
    return harmonicStep * Math.pow(ratio, 1 - c);
  }

  function foldToRange(freq, min, max) {
    if (!(freq > 0)) return min;
    let f = freq;
    while (f < min) f *= 2;
    while (f > max) f /= 2;
    return f;
  }

  function voiceTypeName(voice) {
    return voice instanceof FormantVoice ? 'formant' : 'sine';
  }

  function mutateBase(base, typeName) {
    const next = {
      ...base,
      frequency: Math.max(40, (base.frequency ?? 220) * Random.uniform().linexp(0, 1, 0.7, 1.45).sample()),
      gain: clamp01((base.gain ?? 0.7) * Random.uniform().linexp(0, 1, 0.6, 1.6).sample()),
      attack: Math.max(0.005, (base.attack ?? 0.03) * Random.uniform().linexp(0, 1, 0.5, 2.2).sample()),
      decay: Math.max(0.0, (base.decay ?? 0.08) * Random.uniform().linexp(0, 1, 0.5, 2.2).sample()),
      sustain: Math.min(1.2, Math.max(0.1, (base.sustain ?? 0.8) * Random.uniform().linexp(0, 1, 0.6, 1.5).sample())),
      release: Math.max(0.01, (base.release ?? 0.12) * Random.uniform().linexp(0, 1, 0.5, 2.5).sample()),
    };

    if (typeName === 'formant' && Array.isArray(base.formants)) {
      next.formants = base.formants.map((f, i) => ({
        freq: Math.max(60, f.freq * Random.uniform().linexp(0, 1, 0.7, 1.45 + (i * 0.06)).sample()),
        Q: Math.max(0.15, f.Q * Random.uniform().linexp(0, 1, 0.5, 2.0).sample()),
      }));
    }

    return next;
  }

  function attachVoiceMeter(id, node) {
    if (!ctx) return;
    const outputNode = node?.output?.();
    if (!outputNode?.connect) return;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = ANALYSER_FFT_SIZE;
    analyser.smoothingTimeConstant = 0.78;

    try {
      outputNode.connect(analyser);
    } catch {
      return;
    }

    const type = voiceTypeName(node);
    const typeCount = [...voiceStatsById.values()].filter(
      (s) => voiceTypeName(s.node) === type,
    ).length;
    // Pressure 0 = at or below target, 1 = at or above max → compress lifespan.
    const pressure = clamp01(
      (typeCount - LIFECYCLE_POP_PRESSURE_TARGET)
      / Math.max(1, LIFECYCLE_POP_PRESSURE_MAX - LIFECYCLE_POP_PRESSURE_TARGET),
    );
    const maxForBirth = lerp(LIFECYCLE_LIFESPAN_MAX_SEC, LIFECYCLE_LIFESPAN_MIN_SEC, pressure);
    const lifespan = lerp(LIFECYCLE_LIFESPAN_MIN_SEC, Math.max(LIFECYCLE_LIFESPAN_MIN_SEC, maxForBirth), Math.random());
    voiceStatsById.set(id, {
      id,
      node,
      outputNode,
      analyser,
      freqData: new Float32Array(analyser.frequencyBinCount),
      score: 0,
      createdAt: ctx.currentTime,
      lastUpdatedAt: ctx.currentTime,
      lifespan,
      connectedSpaceId: null,
      connectedSide: null,
    });
    voiceIdByNode.set(node, id);
  }

  function detachVoiceMeterById(id) {
    const stats = voiceStatsById.get(id);
    if (!stats) return;
    try {
      stats.outputNode?.disconnect?.(stats.analyser);
    } catch {
      // no-op
    }
    try {
      stats.analyser?.disconnect?.();
    } catch {
      // no-op
    }
    voiceStatsById.delete(id);
  }

  function updateVoiceScores() {
    if (!ctx) return;

    voiceStatsById.forEach((stats) => {
      stats.analyser.getFloatFrequencyData(stats.freqData);

      let totalAmp = 0;
      let weightedBin = 0;
      let brightAmp = 0;
      let dbSum = 0;

      const nyquist = ctx.sampleRate / 2;
      const binHz = nyquist / Math.max(1, stats.freqData.length);
      const brightBin = Math.floor(BRIGHTNESS_SPLIT_HZ / Math.max(1e-6, binHz));

      for (let i = 0; i < stats.freqData.length; i += 1) {
        const db = Number.isFinite(stats.freqData[i]) ? stats.freqData[i] : -120;
        const amp = Math.pow(10, db / 20);
        totalAmp += amp;
        dbSum += db;
        weightedBin += amp * i;
        if (i >= brightBin) brightAmp += amp;
      }

      const meanDb = stats.freqData.length > 0 ? dbSum / stats.freqData.length : -120;
      const energyNorm = clamp01((meanDb + 100) / 70);
      const centroidNorm = totalAmp > 0
        ? clamp01((weightedBin / totalAmp) / Math.max(1, stats.freqData.length - 1))
        : 0;
      const brightnessNorm = totalAmp > 0 ? clamp01(brightAmp / totalAmp) : 0;

      const instant = (0.6 * energyNorm) + (0.25 * centroidNorm) + (0.15 * brightnessNorm);
      stats.score = lerp(stats.score, instant, SCORE_EMA_ALPHA);
      stats.lastUpdatedAt = ctx.currentTime;
    });
  }

  function pickParentOfType(type) {
    const entries = [...voiceStatsById.values()].filter(
      (s) => voiceTypeName(s.node) === type,
    );
    if (entries.length === 0) return null;
    const total = entries.reduce((sum, s) => sum + Math.max(0.01, s.score), 0);
    let pick = Math.random() * total;
    for (const s of entries) {
      pick -= Math.max(0.01, s.score);
      if (pick <= 0) return s;
    }
    return entries[entries.length - 1];
  }

  async function lifecycleSpawn() {
    if (!ctx || !flow.value?.graph) return;

    // Alternate between sine and formant to keep both populations alive.
    const type = nextSpawnType;
    nextSpawnType = type === 'sine' ? 'formant' : 'sine';

    const parent = pickParentOfType(type);
    const forceRandom = Math.random() < LIFECYCLE_RANDOM_CHANCE;
    const mutate = !forceRandom && parent && Math.random() < LIFECYCLE_MUTATION_CHANCE;

    if (mutate) {
      const base = mutateBase(parent.node.base ?? {}, type);
      await addNode('voice', { voiceType: type, base, origin: 'lifecycle-offspring' });
    } else {
      await addNode('voice', {
        weighted: true,
        weights: type === 'sine' ? { sine: 1, formant: 0 } : { sine: 0, formant: 1 },
        origin: 'lifecycle-random',
      });
    }
  }

  async function lifecycleAge() {
    if (!ctx) return;

    const expired = [];
    voiceStatsById.forEach((stats) => {
      const age = ctx.currentTime - stats.createdAt;
      if (age >= stats.lifespan) expired.push(stats);
    });

    for (const stats of expired) {
      debugLog('lifecycle age-out', { id: stats.id, age: Number((ctx.currentTime - stats.createdAt).toFixed(1)), lifespan: Number(stats.lifespan.toFixed(1)) });
      await removeNodeById(stats.id);
    }
  }

  function meanEnsembleScore() {
    const entries = [...voiceStatsById.values()];
    if (entries.length === 0) return 0;
    return entries.reduce((sum, s) => sum + s.score, 0) / entries.length;
  }

  async function runLifecycle() {
    if (!LIFECYCLE_ENABLED || !ctx) return;

    updateVoiceScores();
    await lifecycleAge();

    const now = ctx.currentTime;
    if (nextSpawnTime === 0) nextSpawnTime = now + LIFECYCLE_SPAWN_INTERVAL_MIN_SEC;

    if (now >= nextSpawnTime) {
      // Low ensemble score → spawn sooner; high score → spawn later.
      const score = meanEnsembleScore();
      const interval = lerp(LIFECYCLE_SPAWN_INTERVAL_MIN_SEC, LIFECYCLE_SPAWN_INTERVAL_MAX_SEC, score);
      nextSpawnTime = now + interval;
      await lifecycleSpawn();
    }
  }

  function estimatePitchCenterHz() {
    const freqs = voices
      .map((v) => v?.base?.frequency)
      .filter((f) => typeof f === 'number' && Number.isFinite(f) && f > 0);

    if (freqs.length === 0) return HARMONIC_ROOT_FALLBACK_HZ;

    const logMean = Math.exp(freqs.reduce((sum, f) => sum + Math.log(f), 0) / freqs.length);
    return foldToRange(logMean, HARMONIC_ROOT_MIN_HZ, HARMONIC_ROOT_MAX_HZ);
  }

  function globalDensityValue() {
    return clamp01((sine.density.value + formant.density.value) / 2);
  }

  function globalCoherenceValue() {
    return clamp01((sine.coherence.value + formant.coherence.value) / 2);
  }

  function nextNodeId(type) {
    if (type === 'voice') {
      const id = `voice-${nextVoiceId}`;
      nextVoiceId += 1;
      return id;
    }

    const id = `space-${nextSpaceId}`;
    nextSpaceId += 1;
    return id;
  }

  function getIdsByPrefix(prefix) {
    return [...flow.value.graph.keys()].filter((id) => id.startsWith(`${prefix}-`));
  }

  function edgeKey(source, target) {
    return `${source}->${target}`;
  }

  function rememberEdge(source, target) {
    edgeKeys.add(edgeKey(source, target));
  }

  function forgetEdge(source, target) {
    edgeKeys.delete(edgeKey(source, target));
  }

  function rootClockBpmFromGlobalDensity(globalDensity) {
    if (globalDensity <= 0) return 0;
    const sourceBpm = bpmFromDensity(globalDensity);
    const normalized = clamp01(sourceBpm / DENSITY_MAX_BPM);
    const shaped = Math.pow(normalized, ROOT_MOTION.densityExponent);
    return lerp(ROOT_MOTION.clockMinBpm, ROOT_MOTION.clockMaxBpm, shaped);
  }

  function sampleRootIntervalSec(clockBpm, globalCoherence) {
    const shape = lerp(ROOT_MOTION.shapeLo, ROOT_MOTION.shapeHi, clamp01(globalCoherence));
    const sampled = Random.gamma_tempo(clockBpm, shape).sample();
    return Math.min(ROOT_MOTION.clockMaxIntervalSec, Math.max(ROOT_MOTION.clockMinIntervalSec, sampled));
  }

  function pickHarmonicRootJump(centerHz, globalCoherence) {
    const c = sigmoid01(globalCoherence, ROOT_MOTION.harmonicitySteepness);

    const harmonicIndex = HARMONIC_INDEX_POOL[Math.floor(Math.random() * HARMONIC_INDEX_POOL.length)];
    const harmonicCandidate = foldToRange(centerHz * harmonicIndex, HARMONIC_ROOT_MIN_HZ, HARMONIC_ROOT_MAX_HZ);

    const offSpreadSemis = lerp(ROOT_MOTION.offSpreadSemisLow, ROOT_MOTION.offSpreadSemisHigh, c);
    const offSemis = Random.uniform().linlin(0, 1, -offSpreadSemis, offSpreadSemis).sample();
    const offRatio = Math.pow(2, offSemis / 12);
    const inharmonicCandidate = foldToRange(centerHz * offRatio, HARMONIC_ROOT_MIN_HZ, HARMONIC_ROOT_MAX_HZ);

    const mixed = lerp(inharmonicCandidate, harmonicCandidate, c);
    return foldToRange(mixed, HARMONIC_ROOT_MIN_HZ, HARMONIC_ROOT_MAX_HZ);
  }

  function updateHarmonicRootScheduler() {
    if (!ctx) return;

    const now = ctx.currentTime;
    if (nextRootChangeTime === 0) nextRootChangeTime = now;
    if (now < nextRootChangeTime) return;

    const gDensity = globalDensityValue();
    const gCoherence = globalCoherenceValue();
    const clockBpm = rootClockBpmFromGlobalDensity(gDensity);

    if (clockBpm <= 0) {
      nextRootChangeTime = now + ROOT_MOTION.clockMaxIntervalSec;
      return;
    }

    const center = estimatePitchCenterHz();
    harmonicRootHz = pickHarmonicRootJump(center, gCoherence);
    nextRootChangeTime = now + sampleRootIntervalSec(clockBpm, gCoherence);
  }

  function ratioFromSemitoneSpread(maxSemitones) {
    const semis = Random.uniform().linlin(0, 1, -maxSemitones, maxSemitones).sample();
    return Math.pow(2, semis / 12);
  }

  function envelopeSegments(voice, adsr) {
    const baseAttack = voice.base?.attack ?? 0;
    const baseDecay = voice.base?.decay ?? 0;
    const baseRelease = voice.base?.release ?? 0;

    const minAttack = baseAttack > 0 ? 0.005 : 0;
    const minDecay = 0;
    const minRelease = baseRelease > 0 ? 0.01 : 0;

    const attack = Math.max(minAttack, baseAttack * (adsr.attack ?? 1));
    const decay = Math.max(minDecay, baseDecay * (adsr.decay ?? 1));
    const release = Math.max(minRelease, baseRelease * (adsr.release ?? 1));

    return (
      {
        baseAttack,
        baseDecay,
        baseRelease,
        minAttack,
        minDecay,
        minRelease,
        attack,
        decay,
        release,
        total: attack + decay + release,
        minTotal: minAttack + minDecay + minRelease,
      }
    );
  }

  function constrainEnvelopeToTime(voice, adsr, maxTime) {
    const segments = envelopeSegments(voice, adsr);
    const budget = Math.max(0, maxTime - 0.001);

    if (segments.total <= budget) return adsr;

    const scalableAttack = Math.max(0, segments.attack - segments.minAttack);
    const scalableDecay = Math.max(0, segments.decay - segments.minDecay);
    const scalableRelease = Math.max(0, segments.release - segments.minRelease);
    const scalableTotal = scalableAttack + scalableDecay + scalableRelease;

    if (scalableTotal <= 0 || budget <= segments.minTotal) {
      return {
        ...adsr,
        attack: segments.baseAttack > 0 ? segments.minAttack / segments.baseAttack : adsr.attack,
        decay: segments.baseDecay > 0 ? segments.minDecay / segments.baseDecay : adsr.decay,
        release: segments.baseRelease > 0 ? segments.minRelease / segments.baseRelease : adsr.release,
      };
    }

    const scale = (budget - segments.minTotal) / scalableTotal;
    const attack = segments.minAttack + (scalableAttack * scale);
    const decay = segments.minDecay + (scalableDecay * scale);
    const release = segments.minRelease + (scalableRelease * scale);

    return {
      ...adsr,
      attack: segments.baseAttack > 0 ? attack / segments.baseAttack : adsr.attack,
      decay: segments.baseDecay > 0 ? decay / segments.baseDecay : adsr.decay,
      release: segments.baseRelease > 0 ? release / segments.baseRelease : adsr.release,
    };
  }

  function buildVoiceDelta(voice, voiceCoherence, isFormant, densityBpm) {
    const c = voiceCoherence;
    const cPitch = sigmoid01(c, PITCH_COHERENCE_STEEPNESS);
    const shapeMul = linexp(c, 0, 1, 0.3, 3.0);
    const jitterSpread = lerp(2.2, 1.03, c);
    const maxFreqSemis = lerp(7.0, 0.6, cPitch);
    const gainSpread = lerp(1.8, 1.1, c);
    const envSpread = 5.0;
    const quantizeStep = coherenceStepSize(cPitch, harmonicRootHz, 0.25);

    const baseTempo = densityBpm;
    const baseShape = 0.5;
    const shapeNow = Math.max(0.1, baseShape * shapeMul);
    const baseTime = Random.gamma_tempo(baseTempo, shapeNow).sample();

    const rawFreq = voice.base.frequency * ratioFromSemitoneSpread(maxFreqSemis);
    const finalFreq = quantize(rawFreq, quantizeStep);
    
    const adsr = {
      attack: Random.truncnorm(1).quantize(c - 9/10).linexp(-1, 1, 0.001, 10).sample(),
      decay: Random.truncnorm(1).quantize(c - 9/10).linexp(-1, 1, 0.005, 10).sample(),
      sustain: lerp(Random.uniform().linlin(0, 1, 0.4, 1.25).sample(), 1, c),
      release: Random.truncnorm(1).quantize(c - 9/10).linexp(-1, 1, 0.005, 10).sample(),
    }

    const sampledTime = baseTime * Random.uniform().linexp(0, 1, 1 / jitterSpread, jitterSpread).sample();
    const constrainedAdsr = constrainEnvelopeToTime(voice, adsr, sampledTime);
    const constrainedEnvelope = envelopeSegments(voice, constrainedAdsr);
    const time = Math.max(sampledTime, constrainedEnvelope.minTotal + 0.001);

    const delta = {
      time,
      frequency: finalFreq / voice.base.frequency,
      gain: Random.uniform().linexp(0, 1, 1 / gainSpread, gainSpread).sample(),
      ...constrainedAdsr,
    };

    if (isFormant) {
      const formantCount = voice.base?.formants?.length ?? voice.filters?.length ?? 0;
      const formantFreqSpread = lerp(4.2, 1.18, cPitch);
      const formantQSpread = lerp(3.4, 1.12, cPitch);
      return {
        ...delta,
        formantFrequency: random_formant_modulation_ratios(formantCount, formantFreqSpread, {
          colorMin: 0.9,
          colorMax: 1.12,
          colorStep: 0.06,
        }),
        formantQ: random_formant_modulation_ratios(formantCount, formantQSpread, {
          colorMin: 0.92,
          colorMax: 1.1,
          colorStep: 0.04,
        }),
      };
    }

    return delta;
  }

  async function startAudio() {
    ctx = Tone.context;

    output = new Output(ctx);
    output.master.gain.value = 1;

    updateInterval = setInterval(update, CONTROL_TIME);
    
  }

  async function ensureAudioRunning() {
    await Tone.start();
    if (ctx?.state !== 'running') {
      await ctx.resume();
    }
  }

  function update() {
    if (!ctx || !flow.value?.graph) return;

    updateHarmonicRootScheduler();

    voices.forEach((voice) => {
      const isFormant = voice instanceof FormantVoice;
      const voiceCoherence = isFormant ? formant.coherence.value : sine.coherence.value;
      const voiceDensity = isFormant
        ? bpmFromDensity(formant.density.value)
        : bpmFromDensity(sine.density.value);

      if (voiceDensity <= 0) return;

      voice.update(buildVoiceDelta(voice, voiceCoherence, isFormant, voiceDensity));
    });
    spaces.forEach((space) => {
      space.update({
        time: Random.exponential(1 / 10).sample(),
      });
    });

    void runLifecycle();
  }

  async function addNode(type, options = {}) {
    await ensureAudioRunning();

    if (!flow.value?.graph) {
      console.warn('addNode skipped: flow not ready', type, options);
      return null;
    }

    const id = nextNodeId(type);

    let node;
    if (type === 'voice') {
      node = options.voiceType
        ? VoiceFactory.createNamed(ctx, options.voiceType, options.base)
        : (options.weighted
          ? VoiceFactory.createWeighted(ctx, options.weights ?? {}, options.base)
          : VoiceFactory.createRandom(ctx, options.base));
      voices.push(node);
    } else if (type === 'space') {
      node = SpaceFactory.create(ctx).randomize();
      node.connect(output);
      const panX = options.pan !== undefined ? options.pan : pickPan(spaces.map((s) => s.base.pannerX));
      const panZ = options.panZ !== undefined ? options.panZ : node.base.pannerZ ?? -0.7;
      node.base.pannerX = panX;
      node.base.pannerZ = panZ;
      node.panner.positionX.value = panX;
      node.panner.positionZ.value = panZ;
      spaces.push(node);
    }

    flow.value.graph.set(id, node);

    // Pick target space + side before computing position.
    const sides = ['top', 'right', 'bottom', 'left'];
    let voiceTargetSpaceId = null;
    let chosenSide = null;

    if (type === 'voice' && spaces.length > 0) {
      // Find a space with a free side, prefer the least-occupied one.
      const candidates = getIdsByPrefix('space')
        .map((sid) => ({ sid, occ: spaceOccupiedSides.get(sid) ?? new Set() }))
        .filter(({ occ }) => occ.size < 4)
        .sort((a, b) => a.occ.size - b.occ.size);

      if (candidates.length > 0) {
        // Pick randomly from the least-occupied tier.
        const minOcc = candidates[0].occ.size;
        const tier = candidates.filter((c) => c.occ.size === minOcc);
        const { sid, occ } = tier[Math.floor(Math.random() * tier.length)];
        const free = sides.filter((s) => !occ.has(s));
        chosenSide = free[Math.floor(Math.random() * free.length)];
        occ.add(chosenSide);
        spaceOccupiedSides.set(sid, occ);
        voiceTargetSpaceId = sid;
      } else {
        debugLog('lifecycle spawn skipped: all space sides occupied');
      }
    }

    const position = options.position ?? getSpawnPosition(type, node, voiceTargetSpaceId, chosenSide);

    if (type === 'space') {
      spacePositions.set(id, position);
      spaceOccupiedSides.set(id, new Set());
    }

    const displayName = type === 'space' ? 'Space'
      : (node instanceof FormantVoice ? 'Formant' : 'Sine');

    const jitterRange = 10;
    const jitter = Object.fromEntries(
      ['source', 'target'].flatMap((t) =>
        sides.map((s) => [`${t}${s.charAt(0).toUpperCase() + s.slice(1)}`, (Math.random() * 2 - 1) * jitterRange]),
      ),
    );

    flow.value.addNodes({
      id,
      type,
      position,
      data: { label: displayName, node, jitter },
    });

    if (voiceTargetSpaceId && chosenSide) {
      const oppositeSide = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[chosenSide];
      const srcHandle = `source-${oppositeSide}`;
      const tgtHandle = `target-${chosenSide}`;
      const nextEdgeKey = `${id}->${voiceTargetSpaceId}`;
      await connect(id, voiceTargetSpaceId);
      suppressedEdgeAdds.add(nextEdgeKey);
      rememberEdge(id, voiceTargetSpaceId);
      flow.value.addEdges({ id: nextEdgeKey, source: id, target: voiceTargetSpaceId, sourceHandle: srcHandle, targetHandle: tgtHandle });
      const stats = voiceStatsById.get(id);
      if (stats) { stats.connectedSpaceId = voiceTargetSpaceId; stats.connectedSide = chosenSide; }
    }

    if (type === 'voice') {
      attachVoiceMeter(id, node);
    }

    debugLog('added node', id, node, options.origin ?? 'manual');
    return id;
  }

  function pickPan(existing, candidates = 32) {
    if (existing.length === 0) return (Math.random() * 2) - 1;
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < candidates; i += 1) {
      const candidate = (Math.random() * 2) - 1;
      const minDist = Math.min(...existing.map((p) => Math.abs(candidate - p)));
      if (minDist > bestScore) {
        bestScore = minDist;
        best = candidate;
      }
    }
    return best;
  }

  function redistributePan(rampTime = 1.5) {
    const n = spaces.length;
    const now = ctx.currentTime;
    spaces.forEach((space, i) => {
      const pan = n === 1 ? 0 : -1 + (2 * i) / (n - 1);
      space.base.pannerX = pan;
      space.panner.positionX.linearRampToValueAtTime(pan, now + rampTime);
    });
  }

  function getSpawnPosition(type, node, targetSpaceId = null, side = null) {
    const W = window.innerWidth;
    const H = window.innerHeight * 0.68;

    if (type === 'space') {
      const pan = node?.base?.pannerX ?? 0;
      const cx = W / 2 - 40;
      const cy = H * 0.72;
      const R = Math.min(W * 0.38, H * 0.6);
      const angle = Math.PI * (1 - (pan + 1) / 2);
      return {
        x: cx + R * Math.cos(angle),
        y: cy - R * Math.sin(angle) * 0.55,
      };
    }

    if (type === 'voice' && targetSpaceId && side) {
      const spacePos = spacePositions.get(targetSpaceId);
      if (spacePos) {
        // Base angle for each cardinal side, then jitter ±40°.
        const baseAngle = { top: -Math.PI / 2, right: 0, bottom: Math.PI / 2, left: Math.PI }[side];
        const jitterRad = (Math.random() * 2 - 1) * (Math.PI * 40 / 180);
        const angle = baseAngle + jitterRad;
        const r = 75 + Math.random() * 37;
        return {
          x: spacePos.x + Math.cos(angle) * r,
          y: spacePos.y + Math.sin(angle) * r,
        };
      }
    }

    return { x: 80 + Math.random() * 300, y: 80 + Math.random() * 300 };
  }

  async function connect(source, target) {
    await ensureAudioRunning();

    const nextEdgeKey = `${source}->${target}`;
    if (suppressedEdgeAdds.has(nextEdgeKey)) {
      suppressedEdgeAdds.delete(nextEdgeKey);
      return;
    }

    const src = flow.value.graph.get(source);
    const tgt = flow.value.graph.get(target);

    debugLog(`connecting ${source} to ${target}`, src, tgt);

    if (!src || !tgt) return;

    debugLog(src, tgt, src.output(), tgt.input());
    debugTable({
      source: inspectLevels(src),
      target: inspectLevels(tgt),
      output: inspectLevels(output),
    });

    try {
      src.connect(tgt);
      rememberEdge(source, target);
    } catch (err) {
      debugLog('connect failed (expected if already connected or disposed)', source, '->', target, err?.message);
    }
  }

  function disconnect(source, target) {
    const src = flow.value.graph.get(source);
    const tgt = flow.value.graph.get(target);

    debugLog(`disconnecting ${source} from ${target}`, src, tgt);

    if (!src || !tgt) return;

    try {
      src.disconnect(tgt);
      forgetEdge(source, target);
    } catch (err) {
      debugLog('disconnect failed (expected if already disconnected or disposed)', source, '->', target, err?.message);
    }
  }

  async function removeNodeById(id) {
    if (!flow.value?.graph?.has(id)) return false;

    const node = flow.value.graph.get(id);
    const type = id.startsWith('space-') ? 'space' : 'voice';

    const touched = [...edgeKeys].filter((nextKey) => {
      const [src, dst] = nextKey.split('->');
      return src === id || dst === id;
    });

    touched.forEach((nextKey) => {
      const [src, dst] = nextKey.split('->');
      disconnect(src, dst);
    });

    if (touched.length > 0 && flow.value.removeEdges) {
      flow.value.removeEdges(touched);
    }

    if (flow.value.removeNodes) {
      flow.value.removeNodes([id]);
    }

    flow.value.graph.delete(id);
    if (type === 'voice') {
      // Read stats BEFORE detachVoiceMeterById deletes them from voiceStatsById.
      const stats = voiceStatsById.get(id);
      if (stats?.connectedSpaceId && stats?.connectedSide) {
        const occupied = spaceOccupiedSides.get(stats.connectedSpaceId);
        if (occupied) occupied.delete(stats.connectedSide);
      }
      detachVoiceMeterById(id);
      const idx = voices.indexOf(node);
      if (idx >= 0) voices.splice(idx, 1);
    } else {
      spacePositions.delete(id);
      spaceOccupiedSides.delete(id);
      const idx = spaces.indexOf(node);
      if (idx >= 0) spaces.splice(idx, 1);
      if (spaces.length > 0) redistributePan(0.7);
    }

    if (node?.dispose) {
      try {
        node.dispose();
      } catch (err) {
        debugLog('dispose failed (expected on hot reload or double-dispose)', id, err?.message);
      }
    }

    return true;
  }

  function disposeAudio() {
    clearInterval(updateInterval);
    voiceStatsById.forEach((_, id) => detachVoiceMeterById(id));
    debugLog('VITE Reload: interval cleared, audio context preserved');
  }

  return {
    startAudio,
    disposeAudio,
    connect,
    disconnect,
    addNode,
    removeNodeById,
    sine,
    formant,
  };
}