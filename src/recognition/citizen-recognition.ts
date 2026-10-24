import { visibleHands, type TrackingFrame } from './landmarks';
import type { WordSample } from './asl-word-recognition';
import { MAX_CONTEXT_CLIP_MS } from './context-word-segmenter';

export const CITIZEN_FRAMES = 128;
export const CITIZEN_JOINTS = 27;
export const CITIZEN_FEATURES = CITIZEN_JOINTS * 2;
const BODY = [0, 2, 5, 11, 12, 13, 14];
const HAND = [0, 4, 5, 8, 9, 12, 13, 16, 17, 20];
const MIRRORED_JOINTS = [0, 2, 1, 4, 3, 6, 5,
  ...Array.from({ length: 10 }, (_, i) => 17 + i), ...Array.from({ length: 10 }, (_, i) => 7 + i)];

/** A second anatomical view, independent of preview mirroring. Swap both body
 * sides and hands before training normalization; absent joints stay absent.
 */
export function mirrorCitizenSamples(samples: readonly WordSample[]): WordSample[] {
  return samples.map((sample) => {
    if (sample.landmarks.length !== CITIZEN_FEATURES || !sample.landmarks.every(Number.isFinite)) {
      throw new Error('Invalid word landmarks for the second recognition pass.');
    }
    const landmarks = new Float32Array(CITIZEN_FEATURES);
    MIRRORED_JOINTS.forEach((source, target) => {
      const x = sample.landmarks[source * 2]; const y = sample.landmarks[source * 2 + 1];
      if (x !== 0 || y !== 0) { landmarks[target * 2] = 1 - x; landmarks[target * 2 + 1] = y; }
    });
    return { timestampMs: sample.timestampMs, landmarks };
  });
}

/** Actual training order AFTER the upstream dataset reorders left/right hands. */
export function packCitizenLandmarks(frame: TrackingFrame): Float32Array {
  const data = new Float32Array(CITIZEN_FEATURES);
  // The reference footage uses a landscape canvas. Normalized portrait X/Y
  // otherwise stretch the same physical hand/arm geometry horizontally. Map
  // portrait coordinates into a centered 4:3 canvas without cropping points.
  // Keep landscape reference inputs unchanged for training parity.
  const xScale = frame.width > 0 && frame.height > frame.width ? (frame.width / frame.height) / (4 / 3) : 1;
  const write = (point: TrackingFrame['pose'][number] | undefined, index: number) => {
    // Training retained every finite pose estimate, including low-visibility
    // elbows outside the crop. Zeroing these changes the learned arm geometry.
    // Capture eligibility checks the shoulder anchors separately.
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      if (point.x === 0 && point.y === 0) return; // reference missing-point sentinel
      data[index * 2] = 0.5 + (point.x - 0.5) * xScale; data[index * 2 + 1] = point.y;
    }
  };
  BODY.forEach((joint, i) => write(frame.pose[joint], i));
  const hands = visibleHands(frame);
  for (const [side, start] of [['Left', 7], ['Right', 17]] as const) {
    const hand = hands.filter((h) => h.side === side).sort((a, b) => b.score - a.score)[0];
    HAND.forEach((joint, i) => write(hand?.landmarks[joint], start + i));
  }
  return data;
}

/** Match the upstream 128-frame padding and clip-level shoulder normalization.
 * Padding BEFORE normalization is intentional: moving it afterwards changes
 * both the scale and every padded frame relative to the trained distribution.
 */
export function createCitizenModelInput(samples: readonly WordSample[]): Float32Array {
  if (samples.length < 4 || samples.some((s, i) => s.landmarks.length !== CITIZEN_FEATURES
    || !s.landmarks.every(Number.isFinite) || !Number.isFinite(s.timestampMs)
    || (i > 0 && s.timestampMs <= samples[i - 1].timestampMs))) {
    throw new Error('The word model needs a clear sequence of body and hand landmarks.');
  }
  const start = samples[0].timestampMs;
  const duration = samples[samples.length - 1].timestampMs - start;
  if (duration > MAX_CONTEXT_CLIP_MS) throw new Error('Use one sign lasting no more than five seconds, plus its brief lead-in and ending.');
  // Reference videos use video frames, not irregular inference-event positions.
  // Reconstruct a nominal 30 Hz clip, then apply the original downsample rule.
  const sourceFrames = Math.floor(duration * 30 / 1000 + 1e-6) + 1;
  const increment = Math.min(1, CITIZEN_FRAMES / sourceFrames);
  const frames = new Float64Array(CITIZEN_FRAMES * CITIZEN_FEATURES);
  let selected = 0; let progress = 0; let cursor = 0;
  for (let frame = 0; frame < sourceFrames && selected < CITIZEN_FRAMES; frame++) {
    progress += increment;
    if (progress <= selected) continue;
    const target = start + frame * 1000 / 30;
    while (cursor + 1 < samples.length && samples[cursor + 1].timestampMs <= target) cursor++;
    const a = samples[cursor]; const b = samples[Math.min(cursor + 1, samples.length - 1)];
    const weight = b.timestampMs === a.timestampMs ? 0 : (target - a.timestampMs) / (b.timestampMs - a.timestampMs);
    for (let joint = 0; joint < CITIZEN_JOINTS; joint++) {
      const offset = joint * 2;
      const present = (sample: WordSample) => sample.landmarks[offset] !== 0 || sample.landmarks[offset + 1] !== 0;
      const interpolate = present(a) && present(b) && b.timestampMs - a.timestampMs <= 250;
      for (let coordinate = 0; coordinate < 2; coordinate++) {
        const left = a.landmarks[offset + coordinate]; const right = b.landmarks[offset + coordinate];
        frames[selected * CITIZEN_FEATURES + offset + coordinate] = interpolate
          ? left + (right - left) * weight : weight <= 0.5 ? left : right;
      }
    }
    selected++;
  }
  let centerX = 0; let centerY = 0; let scale = 0;
  for (let t = 0; t < CITIZEN_FRAMES; t++) {
    const p = t * CITIZEN_FEATURES;
    centerX += (frames[p + 6] + frames[p + 8]) / 2 / CITIZEN_FRAMES;
    centerY += (frames[p + 7] + frames[p + 9]) / 2 / CITIZEN_FRAMES;
    scale += Math.hypot(frames[p + 6] - frames[p + 8], frames[p + 7] - frames[p + 9]) / CITIZEN_FRAMES;
  }
  if (scale < 0.001) throw new Error('Keep both shoulders visible while signing.');
  const output = new Float32Array(2 * CITIZEN_FRAMES * CITIZEN_JOINTS);
  for (let c = 0; c < 2; c++) for (let t = 0; t < CITIZEN_FRAMES; t++) for (let j = 0; j < CITIZEN_JOINTS; j++) {
    output[c * CITIZEN_FRAMES * CITIZEN_JOINTS + t * CITIZEN_JOINTS + j]
      = (frames[t * CITIZEN_FEATURES + j * 2 + c] - (c === 0 ? centerX : centerY)) / scale;
  }
  return output;
} 

