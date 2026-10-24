import labelMap from '../../assets/models/asl_word_labels.json';
import { visibleHands, type Landmark, type TrackingFrame } from './landmarks';

export const WORD_MODEL_FRAMES = 32;
export const LANDMARKS_PER_FRAME = 543;
export const WORD_MODEL_LABELS = Object.entries(labelMap).sort((a, b) => a[1] - b[1]).map(([label]) => label);
export type WordSample = { timestampMs: number; landmarks: Float32Array };
export type WordPrediction = { label: string; confidence: number; margin: number };
export type WordSegment = { kind: 'complete'; samples: WordSample[] }
  | { kind: 'idle' | 'tracking' | 'face-missing' | 'too-short' | 'too-long' | 'interrupted' };

/** Match the original Holistic landmark order, retaining unmirrored image coordinates. */
export function packWordLandmarks(frame: TrackingFrame): Float32Array {
  const values = new Float32Array(LANDMARKS_PER_FRAME * 3).fill(NaN);
  const write = (points: readonly Landmark[], start: number, count: number) => {
    points.slice(0, count).forEach((point, index) => {
      if (![point.x, point.y, point.z].every(Number.isFinite)) return;
      values.set([point.x, point.y, point.z], (start + index) * 3);
    });
  };
  write(frame.face, 0, 468);
  write(frame.pose, 489, 33);
  for (const side of ['Left', 'Right'] as const) {
    const hand = visibleHands(frame).filter((h) => h.side === side).sort((a, b) => b.score - a.score)[0];
    if (hand) write(hand.landmarks, side === 'Left' ? 468 : 522, 21);
  }
  return values;
}

/** Resample time, not event arrival order. NaN denotes an absent landmark to the model. */
export function createWordModelInput(samples: readonly WordSample[]): Float32Array {
  if (samples.length < 4 || samples.some((s, i) => s.landmarks.length !== LANDMARKS_PER_FRAME * 3
    || !Number.isFinite(s.timestampMs) || (i > 0 && s.timestampMs <= samples[i - 1].timestampMs))) {
    throw new Error('Use a clear sign lasting at least half a second.');
  }
  const input = new Float32Array(WORD_MODEL_FRAMES * LANDMARKS_PER_FRAME * 3);
  const start = samples[0].timestampMs;
  const duration = samples[samples.length - 1].timestampMs - start;
  let cursor = 0;
  for (let i = 0; i < WORD_MODEL_FRAMES; i++) {
    const time = start + duration * i / (WORD_MODEL_FRAMES - 1);
    while (cursor < samples.length - 2 && samples[cursor + 1].timestampMs < time) cursor++;
    const a = samples[cursor];
    const b = samples[cursor + 1];
    const weight = (time - a.timestampMs) / (b.timestampMs - a.timestampMs);
    for (let j = 0; j < a.landmarks.length; j++) {
      const left = a.landmarks[j];
      const right = b.landmarks[j];
      input[i * LANDMARKS_PER_FRAME * 3 + j] = Number.isFinite(left) && Number.isFinite(right)
        ? left + (right - left) * weight : weight < 0.5 ? left : right;
    }
  }
  return input;
}

/** The exported model returns logits, not probabilities. Reject uncertain/ambiguous outputs. */
export function decodeWordPrediction(logits: Float32Array, labels: readonly string[] = WORD_MODEL_LABELS): WordPrediction | null {
  if (logits.length !== labels.length || !logits.every(Number.isFinite)) {
    throw new Error('The word model returned invalid class scores.');
  }
  const max = Math.max(...logits);
  const scores = Array.from(logits, (value) => Math.exp(value - max));
  const total = scores.reduce((sum, value) => sum + value, 0);
  const ranking = scores.map((value, index) => ({ index, confidence: value / total }))
    .sort((a, b) => b.confidence - a.confidence);
  const best = ranking[0];
  const margin = best.confidence - ranking[1].confidence;
  if (best.confidence < 0.65 || margin < 0.2) return null;
  return { label: labels[best.index].toUpperCase(), confidence: best.confidence, margin };
}

/** A bounded isolated-sign capture. A brief hands-out pause commits once per movement. */
export class WordSegmenter {
  private samples: WordSample[] = [];
  private lastTimestamp = -1;
  private missingSince: number | null = null;
  private overflow = false;

  constructor(private readonly pack: (frame: TrackingFrame) => Float32Array = packWordLandmarks,
    private readonly hasContext: (frame: TrackingFrame) => boolean = (frame) => frame.face.length >= 468) {}

  reset() {
    this.samples = [];
    this.lastTimestamp = -1;
    this.missingSince = null;
    this.overflow = false;
  }

  finish(): WordSegment {
    const samples = this.samples;
    const overflow = this.overflow;
    this.samples = [];
    this.missingSince = null;
    // Latch until hands leave, preventing a held gesture from being transcribed repeatedly.
    this.overflow = true;
    if (overflow) return { kind: 'idle' };
    if (!samples.length) return { kind: 'idle' };
    if (samples.length < 4 || samples[samples.length - 1].timestampMs - samples[0].timestampMs < 450) {
      return { kind: 'too-short' };
    }
    return { kind: 'complete', samples };
  }

  accept(frame: TrackingFrame): WordSegment {
    const now = frame.timestampMs;
    if (!Number.isFinite(now) || now <= this.lastTimestamp) {
      this.reset();
      return { kind: 'interrupted' };
    }
    if (this.lastTimestamp >= 0 && now - this.lastTimestamp > 800) {
      this.reset(); this.lastTimestamp = now;
      return { kind: 'interrupted' };
    }
    this.lastTimestamp = now;
    if (!visibleHands(frame).length) {
      this.missingSince ??= now;
      if (now - this.missingSince < 550) return { kind: 'idle' };
      const result = this.finish();
      this.overflow = false;
      return result;
    }
    this.missingSince = null;
    if (this.overflow) return { kind: 'idle' };
    if (!this.hasContext(frame)) {
      if (this.samples.length && now - this.samples[this.samples.length - 1].timestampMs > 400) this.samples = [];
      return { kind: 'face-missing' };
    }
    if (this.samples.length >= 160 || (this.samples.length && now - this.samples[0].timestampMs > 5000)) {
      this.samples = []; this.overflow = true;
      return { kind: 'too-long' };
    }
    this.samples.push({ timestampMs: now, landmarks: this.pack(frame) });
    return { kind: 'tracking' };
  }
} 

