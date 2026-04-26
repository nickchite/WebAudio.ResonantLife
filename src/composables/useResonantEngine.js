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

  let ctx;
  let output;
  let updateInterval;
  let harmonicRootHz = HARMONIC_ROOT_FALLBACK_HZ;
  let nextRootChangeTime = 0;
  let nextVoiceId = 0;
  let nextSpaceId = 0;

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
      const formantFreqSpread = 1.6;
      const formantQSpread = 6.0;
      return {
        ...delta,
        formantFrequency: random_formant_modulation_ratios(formantCount, formantFreqSpread),
        formantQ: random_formant_modulation_ratios(formantCount, formantQSpread),
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
      node = options.weighted
        ? VoiceFactory.createWeighted(ctx, options.weights ?? {})
        : VoiceFactory.createRandom(ctx);
      voices.push(node);
    } else if (type === 'space') {
      node = SpaceFactory.create(ctx).randomize();
      node.connect(output);
      const pan = pickPan(spaces.map((s) => s.base.pannerPos));
      node.base.pannerPos = pan;
      node.panner.pan.value = pan;
      spaces.push(node);
    }

    flow.value.graph.set(id, node);

    const position = getSpawnPosition(type);
    flow.value.addNodes({
      id,
      type,
      position,
      data: {
        label: id,
        node,
      },
    });

    if (type === 'voice' && spaces.length > 0) {
      const spaceIds = getIdsByPrefix('space');
      const targetId = spaceIds[Math.floor(Math.random() * spaceIds.length)];
      const nextEdgeKey = `${id}->${targetId}`;

      await connect(id, targetId);
      suppressedEdgeAdds.add(nextEdgeKey);
      rememberEdge(id, targetId);
      flow.value.addEdges({
        id: nextEdgeKey,
        source: id,
        target: targetId,
      });
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
      space.base.pannerPos = pan;
      space.panner.pan.linearRampToValueAtTime(pan, now + rampTime);
    });
  }

  function getSpawnPosition(type) {
    const width = window.innerWidth;
    const isVoice = type === 'voice';
    const minX = isVoice ? 60 : width * 0.6;
    const maxX = isVoice ? width * 0.35 : width - 180;

    return {
      x: minX + Math.random() * Math.max(40, maxX - minX),
      y: 50 + Math.random() * 500,
    };
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
      console.error(err);
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
      console.error(err);
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
      const idx = voices.indexOf(node);
      if (idx >= 0) voices.splice(idx, 1);
    } else {
      const idx = spaces.indexOf(node);
      if (idx >= 0) spaces.splice(idx, 1);
      if (spaces.length > 0) redistributePan(0.7);
    }

    if (node?.dispose) {
      try {
        node.dispose();
      } catch (err) {
        console.error('dispose failed', id, err);
      }
    }

    return true;
  }

  function disposeAudio() {
    clearInterval(updateInterval);
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