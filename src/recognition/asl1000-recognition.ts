import labels from '../../assets/models/asl_1000_labels.json';
import { visibleHands, type Landmark, type TrackingFrame } from './landmarks';
import type { WordSample } from './asl-word-recognition';

export const EXPANDED_WORD_LABELS: readonly string[] = labels;
export const EXPANDED_FRAMES = 50;
const JOINTS = 55;

/** OpenPose upper-body order used by the original WLASL TGCN preprocessing. */
export function packExpandedLandmarks(frame: TrackingFrame): Float32Array {
  const values = new Float32Array(JOINTS * 2).fill(-1);
  const valid = (p: Landmark | undefined): p is Landmark => !!p && Number.isFinite(p.x)
    && Number.isFinite(p.y) && (p.visibility ?? 1) >= 0.5;
  const mid = (a: Landmark | undefined, b: Landmark | undefined): Landmark | undefined =>
    valid(a) && valid(b) ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: 0 } : undefined;
  const pose = frame.pose;
  const body = [pose[0], mid(pose[11], pose[12]), pose[12], pose[14], pose[16],
    pose[11], pose[13], pose[15], mid(pose[23], pose[24]), pose[5], pose[2], pose[8], pose[7]];
  const write = (p: Landmark | undefined, index: number) => {
    if (valid(p)) values.set([2 * p.x - 1, 2 * p.y - 1], index * 2);
  };
  body.forEach(write);
  for (const side of ['Left', 'Right'] as const) {
    const hand = visibleHands(frame).filter((h) => h.side === side).sort((a, b) => b.score - a.score)[0];
    hand?.landmarks.forEach((p, index) => write(p, (side === 'Left' ? 13 : 34) + index));
  }
  return values;
}

/** Joint-major XY pairs across 50 sampled frames: [1,55,100], not [50,55,2]. */
export function createExpandedModelInput(samples: readonly WordSample[]): Float32Array {
  if (samples.length < 4 || samples.some((s, i) => s.landmarks.length !== JOINTS * 2
    || !s.landmarks.every(Number.isFinite) || !Number.isFinite(s.timestampMs)
    || (i > 0 && s.timestampMs <= samples[i - 1].timestampMs))) {
    throw new Error('The expanded word model needs a clear sequence of body and hand landmarks.');
  }
  const values = new Float32Array(JOINTS * EXPANDED_FRAMES * 2);
  const start = samples[0].timestampMs;
  const duration = samples[samples.length - 1].timestampMs - start;
  let cursor = 0;
  for (let time = 0; time < EXPANDED_FRAMES; time++) {
    const target = start + duration * time / (EXPANDED_FRAMES - 1);
    while (cursor < samples.length - 1 && samples[cursor + 1].timestampMs <= target) cursor++;
    const next = Math.min(cursor + 1, samples.length - 1);
    const a = samples[cursor];
    const b = samples[next];
    const weight = next === cursor ? 0 : (target - a.timestampMs) / (b.timestampMs - a.timestampMs);
    for (let joint = 0; joint < JOINTS; joint++) {
      const source = joint * 2;
      const destination = joint * EXPANDED_FRAMES * 2 + time * 2;
      const absent = (sample: WordSample) => sample.landmarks[source] === -1 && sample.landmarks[source + 1] === -1;
      // Interpolate actual observations at phone frame rates. Interpolating a
      // missing-point sentinel would invent a hand moving toward the image edge.
      const interpolate = !absent(a) && !absent(b) && b.timestampMs - a.timestampMs <= 250;
      for (let coordinate = 0; coordinate < 2; coordinate++) {
        const left = a.landmarks[source + coordinate];
        const right = b.landmarks[source + coordinate];
        values[destination + coordinate] = interpolate ? left + (right - left) * weight
          : weight <= 0.5 ? left : right;
      }
    }
  }
  return values;
} 

