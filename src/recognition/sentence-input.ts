import { visibleHands, type Landmark, type TrackingFrame } from './landmarks';

export const SENTENCE_FRAMES = 96;
export const SENTENCE_FEATURES = 208;
export const SENTENCE_TOKENS = 64;
export const SENTENCE_MAX_MS = 12000;
const SAMPLE_MS = 125;
// 25 pose + 21 right hand + 21 left hand + 37 face = 104 XY landmarks.
export const SENTENCE_FACE_POINTS = [0, 4, 13, 14, 17, 33, 39, 46, 52, 55, 61, 64, 81,
  93, 133, 151, 152, 159, 172, 178, 181, 263, 269, 276, 282, 285, 291, 294,
  311, 323, 362, 386, 397, 402, 405, 468, 473] as const;
export type SentenceSample = { timestampMs: number; features: Float32Array; hasHands: boolean; hasContext: boolean };
export type SentenceInput = { features: Float32Array; mask: Float32Array };

type XY = readonly [number, number];
function pixel(point: Landmark | undefined, frame: TrackingFrame): XY {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    ? [point.x * frame.width, point.y * frame.height] : [0, 0];
}

/** Reference sign-space normalization: body relative to shoulders, local square boxes for hands/face. */
export function packSentenceFrame(frame: TrackingFrame): Float32Array | null {
  const shoulders = [frame.pose[11], frame.pose[12]];
  if (frame.width <= 0 || frame.height <= 0 || frame.face.length < 474
    || shoulders.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || (p.visibility ?? 1) < 0.5)) return null;
  const [left, right] = shoulders.map((p) => pixel(p, frame));
  const scale = 1.5 * Math.hypot(left[0] - right[0], left[1] - right[1]);
  if (scale < 10) return null;
  const center = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
  const body = Array.from({ length: 25 }, (_, i) => pixel(frame.pose[i], frame))
    .flatMap((p) => [(p[0] - center[0]) / scale, (p[1] - center[1]) / scale]);
  const local = (points: readonly XY[]) => {
    const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
    const minX = Math.min(...xs); const minY = Math.min(...ys);
    const width = Math.max(...xs) - minX; const height = Math.max(...ys) - minY;
    const side = Math.max(width, height);
    if (side <= 0) return points.flatMap(() => [-1, -1]);
    const xShift = height > width ? Math.floor((height - width) / 2) : 0;
    const yShift = width > height ? Math.floor((width - height) / 2) : 0;
    const padding = side * 0.2;
    return points.flatMap((p) => [
      2 * (p[0] - minX + xShift + padding) / (side + 2 * padding) - 1,
      2 * (p[1] - minY + yShift + padding) / (side + 2 * padding) - 1,
    ]);
  };
  const hands = visibleHands(frame);
  const hand = (side: 'Left' | 'Right') => {
    const detected = hands.filter((h) => h.side === side).sort((a, b) => b.score - a.score)[0];
    return local(Array.from({ length: 21 }, (_, i) => pixel(detected?.landmarks[i], frame)));
  };
  const result = new Float32Array([...body, ...hand('Right'), ...hand('Left'),
    ...local(SENTENCE_FACE_POINTS.map((i) => pixel(frame.face[i], frame)))]);
  return result.every(Number.isFinite) ? result : null;
}

/** Whole utterance capture; hands-out pauses do not end or split a sentence. */
export class SentenceCapture {
  private samples: SentenceSample[] = [];
  private startedAt: number | null = null;
  private lastTimestamp = -1;
  private interrupted = false;

  reset() { this.samples = []; this.startedAt = null; this.lastTimestamp = -1; this.interrupted = false; }

  accept(frame: TrackingFrame): 'capturing' | 'context-missing' | 'limit' | 'interrupted' {
    if (!Number.isFinite(frame.timestampMs) || frame.timestampMs <= this.lastTimestamp
      || (this.lastTimestamp >= 0 && frame.timestampMs - this.lastTimestamp > 800)) {
      this.interrupted = true;
      return 'interrupted';
    }
    if (this.interrupted) return 'interrupted';
    this.startedAt ??= frame.timestampMs;
    this.lastTimestamp = frame.timestampMs;
    if (frame.timestampMs - this.startedAt >= SENTENCE_MAX_MS || this.samples.length >= 400) return 'limit';
    const features = packSentenceFrame(frame);
    // Face/body continue during hands-out pauses. Only actual detection loss
    // receives a missing-frame sentinel, preserving nonmanual transitions.
    this.samples.push({ timestampMs: frame.timestampMs, features: features ?? new Float32Array(SENTENCE_FEATURES), hasContext: !!features,
      hasHands: !!features && visibleHands(frame).length > 0 });
    return features ? 'capturing' : 'context-missing';
  }

  finish(): SentenceInput {
    const samples = this.samples;
    const interrupted = this.interrupted;
    this.reset();
    if (interrupted) throw new Error('Sentence capture was interrupted. Record it again.');
    if (samples.length < 12 || samples[samples.length - 1].timestampMs - samples[0].timestampMs < 1500) {
      throw new Error('Record a sentence lasting at least two seconds.');
    }
    const visible = samples.filter((s) => s.hasHands);
    if (visible.length < 8 || visible.length / samples.length < 0.5) {
      throw new Error('Keep your face, shoulders and signing hands visible for most of the sentence.');
    }
    // A stationary hand or an empty capture is not evidence of a signed sentence.
    // Measure on a fixed time basis. More camera observations must not make
    // the same signing appear stationary because each adjacent step is smaller.
    const motionSamples: SentenceSample[] = [];
    for (const sample of visible) {
      if (!motionSamples.length || sample.timestampMs - motionSamples[motionSamples.length - 1].timestampMs >= SAMPLE_MS) {
        motionSamples.push(sample);
      }
    }
    let movementSum = 0; let movementPairs = 0;
    for (let i = 1; i < motionSamples.length; i++) {
      const previous = motionSamples[i - 1]; const sample = motionSamples[i];
      const elapsed = sample.timestampMs - previous.timestampMs;
      if (elapsed > 250) continue;
      movementSum += sample.features.reduce((distance, v, j) => distance + Math.abs(v - previous.features[j]), 0)
        / SENTENCE_FEATURES * SAMPLE_MS / elapsed;
      movementPairs++;
    }
    const movement = movementPairs ? movementSum / movementPairs : 0;
    if (movement < 0.002) throw new Error('No clear signing movement was captured. Please record the sentence again.');
    const features = new Float32Array(SENTENCE_FRAMES * SENTENCE_FEATURES);
    const mask = new Float32Array(SENTENCE_FRAMES);
    // Native inference is irregular. Sample elapsed time at 8 Hz instead of
    // compressing slow/dropped camera frames into adjacent model time steps.
    const start = samples[0].timestampMs;
    const duration = samples[samples.length - 1].timestampMs - start;
    let cursor = 0;
    const count = Math.min(SENTENCE_FRAMES, Math.floor(duration / SAMPLE_MS) + 1);
    for (let i = 0; i < count; i++) {
      const target = start + i * SAMPLE_MS;
      while (cursor + 1 < samples.length && samples[cursor + 1].timestampMs <= target) cursor++;
      const next = Math.min(cursor + 1, samples.length - 1);
      const sample = target - samples[cursor].timestampMs <= samples[next].timestampMs - target
        ? samples[cursor] : samples[next];
      // Missing face/body is not an observed all-zero pose. Never ask the encoder
      // to attend to it, or hold a distant frame through a long tracking dropout.
      if (!sample.hasContext || Math.abs(sample.timestampMs - target) > 250) continue;
      features.set(sample.features, i * SENTENCE_FEATURES);
      mask[i] = 1;
    }
    return { features, mask };
  }
} 

