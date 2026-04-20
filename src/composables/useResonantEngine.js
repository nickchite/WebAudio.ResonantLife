import { Random, linexp } from '../lib.ts';
import { Output } from '../nodes/misc.ts';
import { FormantVoice, VoiceFactory } from '../nodes/voice.ts';
import { SpaceFactory } from '../nodes/space.ts';
import { ROOT_MOTION } from '../config/rootMotion.js';
import { bpmFromDensity, clamp01, DENSITY_MAX_BPM, lerp } from '../utils/controlMath.ts';

import * as Tone from 'tone';

const PITCH_COHERENCE_STEEPNESS = 12;
const HARMONIC_ROOT_FALLBACK_HZ = 55;
const HARMONIC_ROOT_MIN_HZ = 55;
const HARMONIC_ROOT_MAX_HZ = 110;
const HARMONIC_INDEX_POOL = [1, 2, 3, 4, 5, 6, 8];
const CONTROL_RATE = 100;
const CONTROL_TIME = 1000 / CONTROL_RATE;
const CONTROL_INPUT_SPEED_PER_SEC = 0.12;
const DEBUG_AUDIO_GRAPH = import.meta.env.DEV && import.meta.env.VITE_DEBUG_AUDIO_GRAPH === '1';

export function useResonantEngine(options) {
  const {
    flow,
    sineCoherence,
    formantCoherence,
    sineDensity,
    formantDensity,
    sineCoherenceActual,
    formantCoherenceActual,
    sineDensityActual,
    formantDensityActual,
  } = options;

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

  function moveToward2D(currentX, currentY, targetX, targetY, maxStep) {
    const dx = targetX - currentX;
    const dy = targetY - currentY;
    const distance = Math.hypot(dx, dy);

    if (distance <= maxStep || distance === 0) {
      return [targetX, targetY];
    }

    const scale = maxStep / distance;
    return [currentX + dx * scale, currentY + dy * scale];
  }

  function coherenceStepSize(coherence, harmonicStep = 100, minStep = 0.25) {
    const c = Math.min(1, Math.max(0, coherence));
    const ratio = minStep / harmonicStep;
    return harmonicStep * Math.pow(ratio, 1 - c);
  }

  function quantizeToStep(freq, step) {
    if (step <= 0) return freq;
    return Math.max(step, Math.round(freq / step) * step);
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
    return clamp01((sineDensityActual.value + formantDensityActual.value) / 2);
  }

  function globalCoherenceValue() {
    return clamp01((sineCoherenceActual.value + formantCoherenceActual.value) / 2);
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

  function updateSmoothedControls() {
    const maxStep = CONTROL_INPUT_SPEED_PER_SEC * (CONTROL_TIME / 1000);
    const [nextSineC, nextSineD] = moveToward2D(
      sineCoherenceActual.value,
      sineDensityActual.value,
      sineCoherence.value,
      sineDensity.value,
      maxStep,
    );
    const [nextFormantC, nextFormantD] = moveToward2D(
      formantCoherenceActual.value,
      formantDensityActual.value,
      formantCoherence.value,
      formantDensity.value,
      maxStep,
    );

    sineCoherenceActual.value = nextSineC;
    sineDensityActual.value = nextSineD;
    formantCoherenceActual.value = nextFormantC;
    formantDensityActual.value = nextFormantD;
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

  function envelopeRatio(spread) {
    return Random.uniform().linexp(0, 1, 1 / spread, spread).sample();
  }

  function buildVoiceDelta(voice, voiceCoherence, isFormant, densityBpm) {
    const c = voiceCoherence;
    const cPitch = sigmoid01(c, PITCH_COHERENCE_STEEPNESS);
    const shapeMul = linexp(c, 0, 1, 0.3, 3.0);
    const jitterSpread = lerp(2.2, 1.03, c);
    const maxFreqSemis = lerp(7.0, 0.6, cPitch);
    const gainSpread = lerp(1.8, 1.1, c);
    const envSpread = isFormant
      ? lerp(3.0, 1.08, c)
      : lerp(1.7, 1.05, c);
    const quantizeStep = coherenceStepSize(cPitch, harmonicRootHz, 0.25);

    const baseTempo = densityBpm;
    const baseShape = 0.5;
    const shapeNow = Math.max(0.1, baseShape * shapeMul);
    const baseTime = Random.gamma_tempo(baseTempo, shapeNow).sample();
    const time = baseTime * Random.uniform().linexp(0, 1, 1 / jitterSpread, jitterSpread).sample();

    const rawFreq = voice.base.frequency * ratioFromSemitoneSpread(maxFreqSemis);
    const finalFreq = quantizeToStep(rawFreq, quantizeStep);

    const delta = {
      time,
      frequency: finalFreq / voice.base.frequency,
      gain: Random.uniform().linexp(0, 1, 1 / gainSpread, gainSpread).sample(),
      attack: envelopeRatio(envSpread),
      decay: envelopeRatio(envSpread),
      sustain: lerp(Random.uniform().linlin(0, 1, 0.4, 1.25).sample(), 1, c),
      release: envelopeRatio(envSpread),
    };

    if (isFormant) {
      const formantFreqSpread = lerp(2.8, 1.04, cPitch);
      const formantQSpread = lerp(2.2, 1.02, cPitch);
      return {
        ...delta,
        formantFrequency: Random.uniform().linexp(0, 1, 1 / formantFreqSpread, formantFreqSpread).sample(),
        formantQ: Random.uniform().linexp(0, 1, 1 / formantQSpread, formantQSpread).sample(),
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

    updateSmoothedControls();
    updateHarmonicRootScheduler();

    voices.forEach((voice) => {
      const isFormant = voice instanceof FormantVoice;
      const voiceCoherence = isFormant ? formantCoherenceActual.value : sineCoherenceActual.value;
      const voiceDensity = isFormant
        ? bpmFromDensity(formantDensityActual.value)
        : bpmFromDensity(sineDensityActual.value);

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
  };
}