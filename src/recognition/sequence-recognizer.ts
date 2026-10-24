import { signingFeatures, visibleHands, type TrackingFrame } from './landmarks';

export type MotionSample = { timestampMs: number; features: readonly number[] };
export type SignExample = { label: string; frames: readonly MotionSample[] };
export type WordMatch = { label: string; distance: number; margin: number };
export type SegmentResult = { kind: 'complete'; frames: MotionSample[] }
  | { kind: 'tracking' | 'idle' | 'too-long' | 'interrupted' };

const END_PAUSE_MS = 550;
const MAX_SIGN_MS = 4000;
const MIN_SAMPLES = 6;
const RESAMPLED_FRAMES = 24;
export const MAX_WORDS = 12;
export const EXAMPLES_PER_WORD = 3;

/** An isolated-sign boundary: hands enter view, sign, then leave view for 550ms. */
export class SignSegmenter {
  private frames: MotionSample[] = [];
  private lastTimestamp = -1;
  private missingSince: number | null = null;
  private overflow = false;

  reset() {
    this.frames = [];
    this.lastTimestamp = -1;
    this.missingSince = null;
    this.overflow = false;
  }

  accept(frame: TrackingFrame): SegmentResult {
    const now = frame.timestampMs;
    if (!Number.isFinite(now) || now <= this.lastTimestamp) return { kind: 'interrupted' };
    if (this.lastTimestamp >= 0 && now - this.lastTimestamp > 800) {
      this.reset();
      this.lastTimestamp = now;
      return { kind: 'interrupted' };
    }
    this.lastTimestamp = now;
    if (!visibleHands(frame).length) {
      this.missingSince ??= now;
      if (now - this.missingSince < END_PAUSE_MS) return { kind: 'idle' };
      const frames = this.frames;
      const overflow = this.overflow;
      this.frames = [];
      this.overflow = false;
      if (!overflow && frames.length >= MIN_SAMPLES
        && frames[frames.length - 1].timestampMs - frames[0].timestampMs >= 500) {
        return { kind: 'complete', frames };
      }
      return { kind: 'idle' };
    }
    this.missingSince = null;
    const features = signingFeatures(frame);
    if (!features) {
      this.frames = [];
      return { kind: 'interrupted' };
    }
    if (this.overflow) return { kind: 'too-long' };
    if (this.frames.length >= 64 || (this.frames.length && now - this.frames[0].timestampMs > MAX_SIGN_MS)) {
      this.frames = [];
      this.overflow = true;
      return { kind: 'too-long' };
    }
    this.frames.push({ timestampMs: now, features });
    return { kind: 'tracking' };
  }
}

function resample(frames: readonly MotionSample[]): number[][] | null {
  if (frames.length < MIN_SAMPLES) return null;
  const width = frames[0].features.length;
  if (!width || frames.some((f, i) => f.features.length !== width || !f.features.every(Number.isFinite)
    || !Number.isFinite(f.timestampMs) || (i > 0 && f.timestampMs <= frames[i - 1].timestampMs))) return null;
  const start = frames[0].timestampMs;
  const duration = frames[frames.length - 1].timestampMs - start;
  if (duration < 500 || duration > MAX_SIGN_MS) return null;
  let cursor = 0;
  return Array.from({ length: RESAMPLED_FRAMES }, (_, i) => {
    const time = start + duration * i / (RESAMPLED_FRAMES - 1);
    while (cursor < frames.length - 2 && frames[cursor + 1].timestampMs < time) cursor++;
    const a = frames[cursor];
    const b = frames[cursor + 1];
    const t = (time - a.timestampMs) / (b.timestampMs - a.timestampMs);
    return a.features.map((v, j) => v + (b.features[j] - v) * t);
  });
}

/** Banded dynamic time warping tolerates signing-speed differences without discarding motion order. */
export function sequenceDistance(a: readonly MotionSample[], b: readonly MotionSample[]): number {
  const left = resample(a);
  const right = resample(b);
  if (!left || !right || left[0].length !== right[0].length) return Infinity;
  let previous = Array<number>(right.length + 1).fill(Infinity);
  previous[0] = 0;
  for (let i = 1; i <= left.length; i++) {
    const current = Array<number>(right.length + 1).fill(Infinity);
    for (let j = Math.max(1, i - 6); j <= Math.min(right.length, i + 6); j++) {
      const cost = Math.sqrt(left[i - 1].reduce((sum, v, k) => sum + (v - right[j - 1][k]) ** 2, 0) / left[0].length);
      current[j] = cost + Math.min(previous[j], current[j - 1], previous[j - 1]);
    }
    previous = current;
  }
  return previous[right.length] / Math.max(left.length, right.length);
}

export function normalizeSignLabel(value: string) {
  const label = value.trim().replace(/\s+/g, ' ').toUpperCase();
  return /^[A-Z][A-Z '\-]{0,39}$/.test(label) ? label : null;
}

/** Personal examples, not a pretrained ASL language model. Thresholds require signer validation. */
export class PersonalVocabulary {
  private examples: SignExample[] = [];

  get words() {
    return [...new Set(this.examples.map((e) => e.label))].map((label) => ({
      label, count: this.examples.filter((e) => e.label === label).length,
    }));
  }

  add(label: string, frames: readonly MotionSample[]) {
    const normalized = normalizeSignLabel(label);
    if (!normalized || !resample(frames)) throw new Error('Use a word label and a clear sign lasting 0.5–4 seconds.');
    if (!this.words.some((word) => word.label === normalized) && this.words.length >= MAX_WORDS) {
      throw new Error(`This session supports ${MAX_WORDS} personal words. Clear the vocabulary to teach different words.`);
    }
    const others = this.examples.filter((e) => e.label !== normalized);
    const same = this.examples.filter((e) => e.label === normalized).slice(-(EXAMPLES_PER_WORD - 1));
    this.examples = [...others, ...same, { label: normalized,
      frames: frames.map((f) => ({ timestampMs: f.timestampMs, features: [...f.features] })) }];
  }

  clear() { this.examples = []; }

  match(frames: readonly MotionSample[]): WordMatch | null {
    const candidates = this.words.filter((word) => word.count >= 2).map(({ label }) => {
      const distances = this.examples.filter((e) => e.label === label)
        .map((e) => sequenceDistance(frames, e.frames)).sort((a, b) => a - b);
      // Two examples must agree; one accidental recording cannot establish a word.
      return { label, distance: (distances[0] + distances[1]) / 2 };
    }).sort((a, b) => a.distance - b.distance);
    const best = candidates[0];
    const margin = candidates.length > 1 ? candidates[1].distance - best.distance : Infinity;
    if (!best || !Number.isFinite(best.distance) || best.distance > 0.22 || margin < 0.045) return null;
    return { ...best, margin };
  }
} 

