import { signingFeatures, type TrackingFrame } from '../../src/recognition/landmarks';
import {
  PersonalVocabulary, SignSegmenter, sequenceDistance, type MotionSample,
} from '../../src/recognition/sequence-recognizer';

function motion(offset = 0, duration = 1000, reverse = false): MotionSample[] {
  return Array.from({ length: 12 }, (_, i) => ({
    timestampMs: duration * i / 11,
    features: [offset + (reverse ? 1 - i / 11 : i / 11), offset + i / 22],
  }));
}

function frame(timestampMs: number, withHands = true): TrackingFrame {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  pose[11] = { x: 0.3, y: 0.6, z: 0, visibility: 1 };
  pose[12] = { x: 0.7, y: 0.6, z: 0, visibility: 1 };
  return { timestampMs, width: 480, height: 640, pose, face: [], blendshapes: {}, inferenceMs: 20,
    hands: withHands ? [{ side: 'Left', score: 0.9, landmarks: Array.from({ length: 21 }, (_, i) => ({
      x: 0.4 + i * 0.005, y: 0.3 + i * 0.005, z: 0,
    })) }] : [],
  };
}

describe('motion features', () => {
  it('keeps hand slots stable when detection order changes', () => {
    const f = frame(0);
    const twoHands = { ...f, hands: [...f.hands, { ...f.hands[0], side: 'Right' as const }] };
    expect(signingFeatures(twoHands)).toEqual(signingFeatures({ ...twoHands, hands: [...twoHands.hands].reverse() }));
  });
  it('rejects missing/invalid body anchors instead of inventing location', () => {
    expect(signingFeatures({ ...frame(0), pose: [] })).toBeNull();
    expect(signingFeatures({ ...frame(0), width: NaN })).toBeNull();
  });
});

describe('isolated sign segmentation', () => {
  it('emits a motion sequence once, after a sustained hands-out pause', () => {
    const segmenter = new SignSegmenter();
    for (let time = 0; time <= 1000; time += 100) expect(segmenter.accept(frame(time)).kind).toBe('tracking');
    for (let time = 1100; time <= 1600; time += 100) expect(segmenter.accept(frame(time, false)).kind).toBe('idle');
    const result = segmenter.accept(frame(1700, false));
    expect(result.kind).toBe('complete');
    if (result.kind === 'complete') expect(result.frames).toHaveLength(11);
    expect(segmenter.accept(frame(1800, false)).kind).toBe('idle');
  });
  it('finishes a sign when idle frames skip body and face inference', () => {
    const segmenter = new SignSegmenter();
    for (let time = 0; time <= 1000; time += 100) segmenter.accept(frame(time));
    for (let time = 1100; time <= 1600; time += 100) {
      expect(segmenter.accept({ ...frame(time, false), pose: [], face: [], blendshapes: {} }).kind).toBe('idle');
    }
    expect(segmenter.accept({ ...frame(1700, false), pose: [], face: [], blendshapes: {} }).kind).toBe('complete');
    expect(segmenter.accept(frame(1800)).kind).toBe('tracking');
  });
  it('does not commit a short tracking dropout or a stream interrupted by a long gap', () => {
    const segmenter = new SignSegmenter();
    for (let time = 0; time <= 1000; time += 100) segmenter.accept(frame(time));
    expect(segmenter.accept(frame(1100, false)).kind).toBe('idle');
    expect(segmenter.accept(frame(1200)).kind).toBe('tracking');
    expect(segmenter.accept(frame(2500, false)).kind).toBe('interrupted');
    expect(segmenter.accept(frame(3100, false)).kind).toBe('idle');
  });
  it('discards interrupted sessions and overlong signs rather than splitting them into false words', () => {
    const segmenter = new SignSegmenter();
    for (let time = 0; time <= 4100; time += 100) segmenter.accept(frame(time));
    expect(segmenter.accept(frame(4200)).kind).toBe('too-long');
    for (let time = 4300; time <= 5000; time += 100) expect(segmenter.accept(frame(time, false)).kind).not.toBe('complete');
    segmenter.accept(frame(5100));
    segmenter.reset();
    for (let time = 5200; time <= 5900; time += 100) expect(segmenter.accept(frame(time, false)).kind).not.toBe('complete');
  });
});

describe('personal sequence matching', () => {
  it('tolerates signing speed but preserves the order of motion', () => {
    expect(sequenceDistance(motion(), motion(0, 1800))).toBeCloseTo(0, 5);
    expect(sequenceDistance(motion(), motion(0, 1000, true))).toBeGreaterThan(0.1);
  });
  it('requires two examples and rejects unfamiliar or ambiguous sequences', () => {
    const vocabulary = new PersonalVocabulary();
    vocabulary.add('hello', motion());
    expect(vocabulary.match(motion())).toBeNull();
    vocabulary.add('HELLO', motion(0, 1300));
    expect(vocabulary.match(motion())?.label).toBe('HELLO');
    expect(vocabulary.match(motion(2))).toBeNull();
    vocabulary.add('OTHER', motion());
    vocabulary.add('OTHER', motion());
    expect(vocabulary.match(motion())).toBeNull();
  });
  it('bounds memory and clears learned signs', () => {
    const vocabulary = new PersonalVocabulary();
    for (let i = 0; i < 5; i++) vocabulary.add('hello', motion());
    expect(vocabulary.words).toEqual([{ label: 'HELLO', count: 3 }]);
    vocabulary.clear();
    expect(vocabulary.match(motion())).toBeNull();
    expect(vocabulary.words).toEqual([]);
  });
  it('rejects malformed examples and non-monotonic timestamps', () => {
    expect(sequenceDistance(motion(), [])).toBe(Infinity);
    const malformed = motion();
    malformed[2].timestampMs = 0;
    expect(sequenceDistance(motion(), malformed)).toBe(Infinity);
    expect(() => new PersonalVocabulary().add('', motion())).toThrow();
  });
}); 

