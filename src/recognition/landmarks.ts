export type Landmark = { x: number; y: number; z: number; visibility?: number };
export type TrackedHand = {
  side: 'Left' | 'Right' | 'Unknown';
  score: number;
  landmarks: readonly Landmark[];
};
/** Upright, unmirrored camera coordinates. Timestamps use the native monotonic clock. */
export type TrackingFrame = {
  timestampMs: number;
  width: number;
  height: number;
  hands: readonly TrackedHand[];
  pose: readonly Landmark[];
  face: readonly Landmark[];
  blendshapes: Readonly<Record<string, number>>;
  inferenceMs: number;
};

const EXPRESSIONS = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'mouthPucker', 'mouthSmileLeft', 'mouthSmileRight',
] as const;

function validPoint(point: Landmark | undefined): point is Landmark {
  return !!point && [point.x, point.y, point.z].every(Number.isFinite);
}

export function visibleHands(frame: TrackingFrame) {
  const hands = frame.hands.filter((hand) => hand.score >= 0.6 && hand.landmarks.length === 21
    && hand.landmarks.every(validPoint) && (hand.side === 'Left' || hand.side === 'Right'));
  // Independent hand and pose detectors can disagree on handedness, especially
  // with an unmirrored camera or crossed arms. Match wrists, never screen halves.
  const wrists = [frame.pose[15], frame.pose[16]];
  if (hands.length < 1 || hands.length > 2 || frame.width <= 0 || frame.height <= 0) return hands;
  const reliable = wrists.map((p) => validPoint(p) && (p.visibility ?? 1) >= 0.6);
  if (!reliable.some(Boolean)) return hands;
  const diagonal = Math.hypot(frame.width, frame.height);
  const distance = (hand: TrackedHand, side: number) => Math.hypot(
    (hand.landmarks[0].x - wrists[side].x) * frame.width,
    (hand.landmarks[0].y - wrists[side].y) * frame.height) / diagonal;
  // A lowered/hidden OTHER wrist must not disable identity correction for the
  // signing hand. Require a closer match when only one anatomical anchor exists.
  if (reliable.filter(Boolean).length === 1) {
    const side = reliable[0] ? 0 : 1;
    const distances = hands.map((hand) => distance(hand, side));
    const closest = distances.length === 1 || distances[0] < distances[1] ? 0 : 1;
    if (distances[closest] > 0.08 || (hands.length === 2 && Math.abs(distances[0] - distances[1]) < 0.04)) return hands;
    return hands.map((hand, i) => ({ ...hand,
      side: ((i === closest ? side : 1 - side) === 0 ? 'Left' : 'Right') as 'Left' | 'Right' }));
  }
  if (hands.length === 1) {
    const distances = [distance(hands[0], 0), distance(hands[0], 1)];
    const side = distances[0] < distances[1] ? 0 : 1;
    if (distances[side] > 0.12 || Math.abs(distances[0] - distances[1]) < 0.04) return hands;
    return [{ ...hands[0], side: side === 0 ? 'Left' as const : 'Right' as const }];
  }
  const direct = distance(hands[0], 0) + distance(hands[1], 1);
  const swapped = distance(hands[0], 1) + distance(hands[1], 0);
  const first = direct < swapped ? 0 : 1;
  if (Math.abs(direct - swapped) < 0.04 || distance(hands[0], first) > 0.12
    || distance(hands[1], 1 - first) > 0.12) return hands;
  return hands.map((hand, i) => ({ ...hand,
    side: (i === first ? 'Left' : 'Right') as 'Left' | 'Right' }));
}

/** Body-relative position preserves where a sign occurs; palm-relative shape preserves articulation. */
export function signingFeatures(frame: TrackingFrame): number[] | null {
  const left = frame.pose[11];
  const right = frame.pose[12];
  const nose = frame.pose[0];
  if (frame.width <= 0 || frame.height <= 0 || !validPoint(left) || !validPoint(right)
    || !validPoint(nose) || [left, right, nose].some((p) => (p.visibility ?? 1) < 0.6)) return null;
  const aspect = frame.width / frame.height;
  const scale = Math.hypot((left.x - right.x) * aspect, left.y - right.y);
  if (!Number.isFinite(scale) || scale < 0.08) return null;
  const center = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const hands = visibleHands(frame);
  const features: number[] = [];
  for (const side of ['Left', 'Right'] as const) {
    const hand = hands.filter((h) => h.side === side).sort((a, b) => b.score - a.score)[0];
    if (!hand) { features.push(...Array<number>(67).fill(0)); continue; }
    const wrist = hand.landmarks[0];
    const knuckle = hand.landmarks[9];
    const palm = Math.max(0.02, Math.hypot((knuckle.x - wrist.x) * aspect, knuckle.y - wrist.y));
    features.push(3, (wrist.x - center.x) * aspect / scale, (wrist.y - center.y) / scale,
      (wrist.y - nose.y) / scale);
    for (const point of hand.landmarks) {
      features.push((point.x - wrist.x) * aspect / palm * 0.35,
        (point.y - wrist.y) / palm * 0.35, (point.z - wrist.z) * aspect / palm * 0.35);
    }
  }
  for (const point of [nose, frame.pose[13], frame.pose[14]]) {
    features.push(validPoint(point) ? (point.x - center.x) * aspect / scale * 0.3 : 0,
      validPoint(point) ? (point.y - center.y) / scale * 0.3 : 0);
  }
  features.push(frame.face.length ? 0.3 : 0);
  for (const expression of EXPRESSIONS) features.push((frame.blendshapes[expression] ?? 0) * 0.3);
  return features.every(Number.isFinite) ? features : null;
} 

