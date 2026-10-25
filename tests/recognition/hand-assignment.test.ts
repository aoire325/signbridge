import { visibleHands, type Landmark, type TrackingFrame } from '../../src/recognition/landmarks';
import { packExpandedLandmarks } from '../../src/recognition/asl1000-recognition';
import { packWordLandmarks } from '../../src/recognition/asl-word-recognition';

const point = (x: number, y = 0.5): Landmark => ({ x, y, z: 0, visibility: 1 });
function frame(): TrackingFrame {
  const pose = Array.from({ length: 33 }, () => point(0.5));
  // Crossed arms: the signer's left wrist is on the left of the image.
  pose[15] = point(0.2); pose[16] = point(0.8);
  return { timestampMs: 0, width: 480, height: 640, pose, face: [], blendshapes: {}, inferenceMs: 40,
    hands: [
      { side: 'Right', score: 0.99, landmarks: Array.from({ length: 21 }, () => point(0.2)) },
      { side: 'Left', score: 0.98, landmarks: Array.from({ length: 21 }, () => point(0.8)) },
    ] };
}

describe('hand identity shared by word and sentence inputs', () => {
  it('matches anatomical pose wrists even when labels are reversed and arms cross', () => {
    const original = frame();
    expect(visibleHands(original).map((h) => h.side)).toEqual(['Left', 'Right']);
    expect(original.hands.map((h) => h.side)).toEqual(['Right', 'Left']);
    expect(packWordLandmarks(original)[468 * 3]).toBeCloseTo(0.2);
    expect(packWordLandmarks(original)[522 * 3]).toBeCloseTo(0.8);
    expect(packExpandedLandmarks(original)[26]).toBeCloseTo(-0.6);
    expect(packExpandedLandmarks(original)[68]).toBeCloseTo(0.6);
  });

  it('assigns two hands one-to-one even if the hand classifier gives duplicate labels', () => {
    const original = frame();
    expect(visibleHands({ ...original, hands: original.hands.map((h) => ({ ...h, side: 'Left' })) })
      .map((h) => h.side)).toEqual(['Left', 'Right']);
    expect(visibleHands({ ...original, hands: original.hands.slice(0, 1) })[0].side).toBe('Left');
  });

  it('retains classifier identity when pose wrists are missing, occluded, far away or ambiguous', () => {
    const original = frame();
    for (const pose of [[], original.pose.map((p) => ({ ...p, visibility: 0.1 })),
      original.pose.map(() => point(0.5)), original.pose.map(() => point(0.5, 0.1))]) {
      expect(visibleHands({ ...original, pose }).map((h) => h.side)).toEqual(['Right', 'Left']);
    }
  });

  it('corrects the signing hand when only its own pose wrist is visible', () => {
    const original = frame();
    const pose = original.pose.map((p, i) => i === 16 ? { ...p, visibility: 0.1 } : p);
    const input = { ...original, pose, hands: original.hands.slice(0, 1) };
    expect(visibleHands(input)[0].side).toBe('Left');
    expect(packWordLandmarks(input)[468 * 3]).toBeCloseTo(0.2);
    expect(Number.isNaN(packWordLandmarks(input)[522 * 3])).toBe(true);
    expect(visibleHands({ ...original, pose }).map((h) => h.side)).toEqual(['Left', 'Right']);
    expect(original.hands[0].side).toBe('Right');
  });

  it('does not reassign a distant or ambiguous hand using one visible wrist', () => {
    const original = frame();
    const pose = original.pose.map((p, i) => i === 16 ? { ...p, visibility: 0 } : p);
    expect(visibleHands({ ...original, pose, hands: original.hands.slice(1) })[0].side).toBe('Left');
    const ambiguous = original.hands.map((h) => ({ ...h, landmarks: original.hands[0].landmarks }));
    expect(visibleHands({ ...original, pose, hands: ambiguous }).map((h) => h.side)).toEqual(['Right', 'Left']);
  });

  it('preserves detected hands with uncertain handedness when pose wrists identify them', () => {
    const original = frame();
    const input = { ...original, hands: original.hands.map((hand) => ({ ...hand, score: 0.51 })) };
    expect(visibleHands(input).map((hand) => hand.side)).toEqual(['Left', 'Right']);
    expect(packWordLandmarks(input)[468 * 3]).toBeCloseTo(0.2);
    expect(packWordLandmarks(input)[522 * 3]).toBeCloseTo(0.8);
    expect(visibleHands({ ...input, hands: input.hands.slice(0, 1) })[0].side).toBe('Left');
    expect(input.hands.map((hand) => hand.side)).toEqual(['Right', 'Left']);
  });

  it('only rescues the directly anchored hand when the other pose wrist is missing', () => {
    const original = frame();
    const input = { ...original,
      pose: original.pose.map((p, i) => i === 16 ? { ...p, visibility: 0.1 } : p),
      hands: original.hands.map((hand) => ({ ...hand, score: 0.51 })) };
    expect(visibleHands(input).map((hand) => hand.side)).toEqual(['Left']);
    expect(visibleHands({ ...input, hands: input.hands.slice(1) })).toEqual([]);
  });

  it('rejects uncertain handedness when anatomical association is absent or ambiguous', () => {
    const original = frame();
    const hands = original.hands.map((hand) => ({ ...hand, score: 0.51 }));
    for (const pose of [[], original.pose.map((p) => ({ ...p, visibility: 0.1 })),
      original.pose.map(() => point(0.5)), original.pose.map(() => point(0.5, 0.1))]) {
      expect(visibleHands({ ...original, pose, hands })).toEqual([]);
    }
    const pose = original.pose.map((p, i) => i === 16 ? { ...p, visibility: 0 } : p);
    const ambiguous = hands.map((hand) => ({ ...hand, landmarks: hands[0].landmarks }));
    expect(visibleHands({ ...original, pose, hands: ambiguous })).toEqual([]);
    for (const width of [0, NaN, Infinity]) expect(visibleHands({ ...original, hands, width })).toEqual([]);
  });

  it('does not rescue malformed hands even with a matching pose wrist', () => {
    const original = frame();
    for (const score of [0.1, NaN, Infinity, 1.1]) {
      expect(visibleHands({ ...original, hands: original.hands.map((hand) => ({ ...hand, score })) })).toEqual([]);
    }
    expect(visibleHands({ ...original, hands: original.hands.map((hand) => ({ ...hand, score: 0.51,
      landmarks: hand.landmarks.map((point, i) => i === 8 ? { ...point, x: NaN } : point) })) })).toEqual([]);
  });
}); 

