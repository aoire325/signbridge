import { visibleHands, type TrackingFrame } from './landmarks';

/** Conservative visible-rest boundary. A still hand near the face/chest is
 * still signing; only lowered hands below their elbows can count as rest.
 * This is a capture heuristic, not a trained sign/non-sign classifier.
 */
export class VisibleRestDetector {
  private previous: { timestampMs: number; positions: number[]; sides: string } | null = null;

  reset() { this.previous = null; }

  accept(frame: TrackingFrame): boolean {
    const hands = visibleHands(frame).slice().sort((a, b) => a.side.localeCompare(b.side));
    const left = frame.pose[11]; const right = frame.pose[12];
    const valid = [left, right].every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 1) >= 0.6);
    if (!valid || !hands.length || frame.width <= 0 || frame.height <= 0) { this.reset(); return false; }
    const aspect = frame.width / frame.height;
    const scale = Math.hypot((left.x - right.x) * aspect, left.y - right.y);
    if (!Number.isFinite(scale) || scale < 0.03) { this.reset(); return false; }
    const x = (left.x + right.x) / 2; const y = (left.y + right.y) / 2;
    const lowered = hands.every((hand) => {
      const elbow = frame.pose[hand.side === 'Left' ? 13 : 14]; const wrist = hand.landmarks[0];
      return elbow && (elbow.visibility ?? 1) >= 0.6 && Number.isFinite(elbow.y)
        && wrist.y > y + scale * 0.85 && wrist.y > elbow.y + scale * 0.15;
    });
    const positions = hands.flatMap((hand) => hand.landmarks.flatMap((p) => [(p.x - x) * aspect / scale, (p.y - y) / scale,
      (p.z - hand.landmarks[0].z) * aspect / scale]));
    const previous = this.previous; const sides = hands.map((hand) => hand.side).join(',');
    this.previous = { timestampMs: frame.timestampMs, positions, sides };
    const dt = previous ? (frame.timestampMs - previous.timestampMs) / 1000 : 0;
    if (!lowered || !previous || previous.sides !== sides || dt <= 0 || dt > 0.25) return false;
    const speed = Math.max(...positions.map((v, i) => Math.abs(v - previous.positions[i]) / dt));
    return speed < 0.25;
  }
}
