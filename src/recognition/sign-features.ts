import { visibleHands, type Landmark, type TrackingFrame } from './landmarks';

// This version is separate from the fixed pretrained TFLite input layouts.
export const SIGN_FEATURE_VERSION = 1;
export const SIGN_SEQUENCE_FRAMES = 24;
const BODY = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16];
const FACE = [1, 33, 263, 61, 291, 152, 13, 14];
const EXPRESSIONS = ['browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'mouthPucker', 'mouthSmileLeft', 'mouthSmileRight'];
export const SIGN_FEATURE_WIDTH = BODY.length * 2 + 2 * 77 + FACE.length * 2 + EXPRESSIONS.length;
export type FeatureFrame = { timestampMs: number; values: number[]; mask: number[] };
export type SignSequence = { version: 1; durationMs: number; frames: FeatureFrame[] };
const valid = (p?: Landmark): p is Landmark => !!p && [p.x, p.y, p.z].every(Number.isFinite) && (p.visibility ?? 1) >= 0.5;
const clamp = (value: number) => Math.max(-8, Math.min(8, value));

/** Full finger articulation, palm direction, body/face location and expression.
 * Hand Z is wrist-relative estimated depth. It is never compared with face Z.
 * Missing observations have explicit masks, not invented zero-valued joints.
 */
export function signFeatureFrame(frame: TrackingFrame): FeatureFrame | null {
  const left = frame.pose[11]; const right = frame.pose[12];
  if (!valid(left) || !valid(right) || frame.width <= 0 || frame.height <= 0 || !Number.isFinite(frame.timestampMs)) return null;
  const aspect = frame.width / frame.height;
  const scale = Math.hypot((left.x - right.x) * aspect, left.y - right.y);
  if (!Number.isFinite(scale) || scale < 0.03) return null;
  const center = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const values: number[] = []; const mask: number[] = [];
  const add = (value: number, present: boolean) => { values.push(present && Number.isFinite(value) ? clamp(value) : 0); mask.push(present && Number.isFinite(value) ? 1 : 0); };
  const position = (p?: Landmark) => {
    add(p ? (p.x - center.x) * aspect / scale : 0, valid(p));
    add(p ? (p.y - center.y) / scale : 0, valid(p));
  };
  BODY.forEach((index) => position(frame.pose[index]));
  const hands = visibleHands(frame);
  for (const side of ['Left', 'Right'] as const) {
    const hand = hands.filter((h) => h.side === side).sort((a, b) => b.score - a.score)[0];
    if (!hand) { for (let i = 0; i < 77; i++) add(0, false); continue; }
    const points = hand.landmarks; const wrist = points[0];
    const palm = Math.max(0.02, Math.hypot((points[9].x - wrist.x) * aspect, points[9].y - wrist.y));
    position(wrist);
    const local = points.map((p) => [(p.x - wrist.x) * aspect / palm, (p.y - wrist.y) / palm, (p.z - wrist.z) * aspect / palm]);
    local.forEach((p, i) => p.forEach((v) => add(v * 0.35, valid(points[i]))));
    const a = local[5]; const b = local[17];
    const normal = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const length = Math.hypot(...normal);
    normal.forEach((v) => add(length > 0.001 ? v / length * 0.35 : 0, length > 0.001 && [wrist, points[5], points[17]].every(valid)));
    for (const [base, joint, tip] of [[1, 2, 4], [5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]]) {
      const u = local[base].map((v, i) => v - local[joint][i]);
      const v = local[tip].map((x, i) => x - local[joint][i]);
      const denominator = Math.hypot(...u) * Math.hypot(...v);
      add(denominator > 0.001 ? u.reduce((sum, x, i) => sum + x * v[i], 0) / denominator * 0.35 : 0,
        denominator > 0.001 && [points[base], points[joint], points[tip]].every(valid));
    }
    const nose = valid(frame.face[1]) ? frame.face[1] : frame.pose[0];
    for (const tip of [4, 8]) {
      add(nose ? (points[tip].x - nose.x) * aspect / scale : 0, valid(nose) && valid(points[tip]));
      add(nose ? (points[tip].y - nose.y) / scale : 0, valid(nose) && valid(points[tip]));
    }
  }
  FACE.forEach((index) => position(frame.face[index]));
  EXPRESSIONS.forEach((name) => add((frame.blendshapes[name] ?? 0) * 0.3, Number.isFinite(frame.blendshapes[name])));
  return { timestampMs: frame.timestampMs, values, mask };
}

/** Time-based resampling plus velocity. A >250 ms gap remains masked. */
export function buildSignSequence(input: readonly FeatureFrame[]): SignSequence | null {
  if (input.length < 4 || input.some((f, i) => f.values.length !== SIGN_FEATURE_WIDTH || f.mask.length !== SIGN_FEATURE_WIDTH
    || !f.values.every(Number.isFinite) || !f.mask.every((x) => x === 0 || x === 1) || !Number.isFinite(f.timestampMs)
    || (i > 0 && f.timestampMs <= input[i - 1].timestampMs))) return null;
  const start = input[0].timestampMs; const durationMs = input.at(-1)!.timestampMs - start;
  if (durationMs < 450 || durationMs > 6500) return null;
  let cursor = 0;
  const frames: FeatureFrame[] = [];
  for (let i = 0; i < SIGN_SEQUENCE_FRAMES; i++) {
    const timestampMs = durationMs * i / (SIGN_SEQUENCE_FRAMES - 1); const time = start + timestampMs;
    while (cursor + 1 < input.length && input[cursor + 1].timestampMs <= time) cursor++;
    const a = input[cursor]; const b = input[Math.min(cursor + 1, input.length - 1)];
    const dt = b.timestampMs - a.timestampMs; const t = dt ? (time - a.timestampMs) / dt : 0;
    const nearest = t <= 0.5 ? a : b;
    const mask = a.mask.map((_, j) => dt <= 250 && a.mask[j] && b.mask[j] ? 1 : Math.abs(time - nearest.timestampMs) <= 80 ? nearest.mask[j] : 0);
    const values = a.values.map((v, j) => !mask[j] ? 0 : dt <= 250 && a.mask[j] && b.mask[j] ? v + (b.values[j] - v) * t : nearest.values[j]);
    const previous = frames.at(-1);
    const velocityMask = mask.map((m, j) => previous && m && previous.mask[j] ? 1 : 0);
    const velocity = values.map((v, j) => velocityMask[j] ? clamp((v - previous!.values[j]) / ((timestampMs - previous!.timestampMs) / 1000)) * 0.1 : 0);
    frames.push({ timestampMs, values: [...values, ...velocity].map((v) => Math.round(v * 100000) / 100000), mask: [...mask, ...velocityMask] });
  }
  return { version: SIGN_FEATURE_VERSION, durationMs, frames };
}

export function validSignSequence(sequence: SignSequence): boolean {
  return sequence?.version === SIGN_FEATURE_VERSION && Number.isFinite(sequence.durationMs) && sequence.durationMs >= 450 && sequence.durationMs <= 6500
    && Array.isArray(sequence.frames) && sequence.frames.length === SIGN_SEQUENCE_FRAMES
    && sequence.frames.every((f, i) => !!f && Number.isFinite(f.timestampMs) && Math.abs(f.timestampMs - sequence.durationMs * i / (SIGN_SEQUENCE_FRAMES - 1)) < 0.01
      && Array.isArray(f.values) && f.values.length === SIGN_FEATURE_WIDTH * 2 && f.values.every((v) => Number.isFinite(v) && Math.abs(v) <= 8)
      && Array.isArray(f.mask) && f.mask.length === f.values.length && f.mask.every((v) => v === 0 || v === 1));
}

function observedCoordinates(frame: FeatureFrame, start: number, end: number): boolean {
  let count = 0;
  for (let i = start; i < end; i++) if (frame.mask[i] && ++count >= 20) return true;
  return false;
}
const observedPosition = (frame: FeatureFrame) => observedCoordinates(frame, 0, SIGN_FEATURE_WIDTH);

/** Judge the data that survived resampling, rather than a phone's worst frame
 * interval. Long gaps stay masked; at least half the clip and three hand-bearing
 * frames must still be observed before it can be used for personal matching.
 */
export function sufficientSignTracking(sequence: SignSequence): boolean {
  return validSignSequence(sequence)
    && sequence.frames.filter(observedPosition).length >= SIGN_SEQUENCE_FRAMES / 2
    && sequence.frames.filter((frame) => observedCoordinates(frame, BODY.length * 2, BODY.length * 2 + 154)).length >= 3;
}

/** Banded DTW follows the existing personal recognizer's temporal alignment,
 * with visibility-aware costs so absent face/finger points do not become poses.
 */
export function richSequenceDistance(a: SignSequence, b: SignSequence): number {
  if (!sufficientSignTracking(a) || !sufficientSignTracking(b)) return Infinity;
  const observedA = a.frames.map(observedPosition); const observedB = b.frames.map(observedPosition);
  let previous = Array<number>(SIGN_SEQUENCE_FRAMES + 1).fill(Infinity); previous[0] = 0;
  for (let i = 1; i <= SIGN_SEQUENCE_FRAMES; i++) {
    const current = Array<number>(SIGN_SEQUENCE_FRAMES + 1).fill(Infinity);
    for (let j = Math.max(1, i - 6); j <= Math.min(SIGN_SEQUENCE_FRAMES, i + 6); j++) {
      const left = a.frames[i - 1]; const right = b.frames[j - 1];
      let sum = 0; let count = 0; let missing = 0;
      for (let k = 0; k < left.values.length; k++) {
        if (left.mask[k] && right.mask[k]) { sum += (left.values[k] - right.values[k]) ** 2; count++; }
        else if (left.mask[k] !== right.mask[k]) missing++;
      }
      // A masked time slot carries a bounded missing-data cost, not invented
      // coordinates or an infinite barrier across the entire DTW path. Even two
      // missing slots pay this cost rather than counting as identical poses.
      const cost = !observedA[i - 1] || !observedB[j - 1] ? 0.15
        : count >= 20 ? Math.sqrt(sum / count) + missing / left.values.length * 0.15 : Infinity;
      current[j] = cost + Math.min(previous[j], current[j - 1], previous[j - 1]);
    }
    previous = current;
  }
  return previous[SIGN_SEQUENCE_FRAMES] / SIGN_SEQUENCE_FRAMES;
}
