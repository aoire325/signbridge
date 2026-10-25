import { buildSignSequence, richSequenceDistance, signFeatureFrame, SIGN_FEATURE_WIDTH, sufficientSignTracking, validSignSequence } from '../../src/recognition/sign-features';
import type { TrackingFrame } from '../../src/recognition/landmarks';

export function trackingFrame(timestampMs: number, bend = 0): TrackingFrame {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.4, z: 0, visibility: 1 }));
  pose[0] = { ...pose[0], y: 0.2 }; pose[11].x = 0.3; pose[12].x = 0.7;
  pose[15] = { ...pose[15], x: 0.4, y: 0.5 };
  const landmarks = Array.from({ length: 21 }, (_, i) => ({ x: 0.4 + i % 4 * 0.02, y: 0.5 - Math.floor(i / 4) * 0.02, z: 0 }));
  landmarks[8].y += bend; landmarks[8].z = bend / 2;
  return { timestampMs, width: 480, height: 640, pose, face: [], blendshapes: {}, inferenceMs: 20,
    hands: [{ side: 'Left', score: 0.99, landmarks }] };
}
const sequence = (bend: number) => buildSignSequence(Array.from({ length: 11 }, (_, i) => signFeatureFrame(trackingFrame(i * 100, bend))!))!;

describe('rich sign features', () => {
  it('distinguishes finger articulation with identical wrist positions', () => {
    const first = sequence(0); const bent = sequence(0.08);
    expect(validSignSequence(first)).toBe(true);
    expect(first.frames[0].values).toHaveLength(SIGN_FEATURE_WIDTH * 2);
    expect(richSequenceDistance(first, first)).toBe(0);
    expect(richSequenceDistance(first, bent)).toBeGreaterThan(0.01);
  });
  it('preserves body-relative location, hand depth and expression separately', () => {
    const base = trackingFrame(0); const original = signFeatureFrame(base)!;
    const shifted = { ...base, hands: base.hands.map((hand) => ({ ...hand, landmarks: hand.landmarks.map((p) => ({ ...p, y: p.y - 0.2 })) })) };
    expect(signFeatureFrame(shifted)!.values).not.toEqual(original.values);
    const depth = { ...base, hands: base.hands.map((h) => ({ ...h, landmarks: h.landmarks.map((p, i) => ({ ...p, z: i === 8 ? 0.1 : 0 })) })) };
    expect(signFeatureFrame(depth)!.values).not.toEqual(original.values);
    const expression = signFeatureFrame({ ...base, blendshapes: { jawOpen: 0.9 } })!;
    expect(expression.mask.filter(Boolean).length).toBe(original.mask.filter(Boolean).length + 1);
    expect(expression.values).not.toEqual(original.values);
  });
  it('uses explicit missing masks and refuses absent body anchors', () => {
    expect(signFeatureFrame({ ...trackingFrame(0), pose: [] })).toBeNull();
    const full = signFeatureFrame(trackingFrame(0))!;
    const missing = signFeatureFrame({ ...trackingFrame(0), hands: [] })!;
    expect(missing.mask.filter(Boolean).length).toBeLessThan(full.mask.filter(Boolean).length);
    expect(missing.mask.slice(22, 22 + 154).every((m) => m === 0)).toBe(true);
  });
  it('resamples actual timestamps, masks long gaps and rejects clock resets', () => {
    const frames = [0, 100, 200, 800, 900, 1000].map((t) => signFeatureFrame(trackingFrame(t))!);
    const resampled = buildSignSequence(frames)!;
    expect(resampled.frames[12].mask.every((m) => m === 0)).toBe(true);
    expect(buildSignSequence([...frames, frames[0]])).toBeNull();
    expect(buildSignSequence(frames.slice(0, 3))).toBeNull();
    expect(validSignSequence({ ...resampled, frames: [null] } as never)).toBe(false);
  });
  it('keeps elapsed-time velocity and temporal ordering', () => {
    const moving = (reverse: boolean) => buildSignSequence(Array.from({ length: 11 }, (_, i) => signFeatureFrame(trackingFrame(i * 100, (reverse ? 10 - i : i) * 0.01))!))!;
    const forward = moving(false); const backward = moving(true);
    expect(forward.frames.some((f) => f.values.slice(SIGN_FEATURE_WIDTH).some((v) => Math.abs(v) > 0.001))).toBe(true);
    expect(richSequenceDistance(forward, backward)).toBeGreaterThan(0.01);
  });
  it('can match through a brief pause without filling in unobserved movement', () => {
    const gappy = (bend: number) => buildSignSequence([0, 100, 200, 700, 800, 900, 1000]
      .map((t) => signFeatureFrame(trackingFrame(t, bend))!))!;
    const recorded = gappy(0);
    expect(recorded.frames[10].mask.every((m) => m === 0)).toBe(true);
    expect(sufficientSignTracking(recorded)).toBe(true);
    const self = richSequenceDistance(recorded, recorded);
    expect(self).toBeGreaterThan(0); // Missing observations are penalized, including matching gaps.
    expect(self).toBeLessThan(0.12);
    expect(richSequenceDistance(recorded, sequence(0))).toBeLessThan(0.12);
    expect(richSequenceDistance(recorded, gappy(0.2))).toBeGreaterThan(self);
  });
  it('refuses mostly missing clips and clips with no observed hands', () => {
    const sparse = buildSignSequence([0, 1, 2, 1000].map((t) => signFeatureFrame(trackingFrame(t))!))!;
    expect(validSignSequence(sparse)).toBe(true);
    expect(sufficientSignTracking(sparse)).toBe(false);
    expect(richSequenceDistance(sparse, sparse)).toBe(Infinity);
    const noHands = buildSignSequence(Array.from({ length: 11 }, (_, i) => signFeatureFrame({ ...trackingFrame(i * 100), hands: [] })!))!;
    expect(sufficientSignTracking(noHands)).toBe(false);
    expect(richSequenceDistance(noHands, sequence(0))).toBe(Infinity);
  });
});
