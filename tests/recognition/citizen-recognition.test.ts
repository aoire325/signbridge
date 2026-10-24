import fixture from './citizen-preprocessing-fixture.json';
import { CITIZEN_FEATURES, createCitizenModelInput, packCitizenLandmarks } from '../../src/recognition/citizen-recognition';
import type { Landmark, TrackingFrame } from '../../src/recognition/landmarks';

const samples = () => fixture.samples.map((s) => ({ timestampMs: s.timestampMs, landmarks: new Float32Array(s.landmarks) }));

describe('ASL Citizen training-compatible preprocessing', () => {
  it('matches the actual upstream dataset across all 6,912 input coordinates', () => {
    const actual = createCitizenModelInput(samples());
    expect(actual).toHaveLength(2 * 128 * 27);
    const error = actual.reduce((max, value, i) => Math.max(max, Math.abs(value - fixture.expected[i])), 0);
    expect(error).toBeLessThan(0.00001);
    // Normalized padding is nonzero in this checkpoint's training pipeline.
    expect(actual[127 * 27]).not.toBe(0);
  });

  it('packs seven body points, ten left-hand points, then ten right-hand points', () => {
    const point = (x: number) => ({ x, y: 0.5, z: 0, visibility: 1 });
    const pose = Array.from({ length: 33 }, (_, i) => point(i / 40));
    const frame: TrackingFrame = { timestampMs: 0, width: 640, height: 480, pose, face: [], blendshapes: {}, inferenceMs: 30,
      hands: [{ side: 'Left', score: 0.99, landmarks: Array.from({ length: 21 }, (_, i) => point(0.1 + i / 100)) },
        { side: 'Right', score: 0.99, landmarks: Array.from({ length: 21 }, (_, i) => point(0.8 + i / 100)) }] };
    const packed = packCitizenLandmarks(frame);
    expect(packed).toHaveLength(CITIZEN_FEATURES);
    expect(packed[6]).toBeCloseTo(11 / 40);
    expect(packed[14]).toBeCloseTo(0.1);
    expect(packed[16]).toBeCloseTo(0.14); // left thumb tip (index 4)
    expect(packed[34]).toBeCloseTo(0.8);
    pose[13] = { ...pose[13], x: 0.9, y: 1.3, visibility: 0.1 };
    const occluded = packCitizenLandmarks(frame);
    expect(occluded[10]).toBeCloseTo(0.9);
    expect(occluded[11]).toBeCloseTo(1.3);
    expect(packCitizenLandmarks({ ...frame, hands: [] }).slice(14).every((v) => v === 0)).toBe(true);
  });

  it.each([[480, 640], [540, 960]])('preserves hand/arm geometry in a centered %i × %i portrait crop', (width, height) => {
    const point = (x: number) => ({ x, y: 0.5, z: 0, visibility: 1 });
    const pose = Array.from({ length: 33 }, () => point(0.5));
    pose[11] = point(0.4); pose[12] = point(0.6); pose[15] = point(0.45); pose[16] = point(0.55);
    const landscape: TrackingFrame = { timestampMs: 0, width: 640, height: 480, pose, face: [], blendshapes: {}, inferenceMs: 30,
      hands: [{ side: 'Left', score: 0.99, landmarks: Array.from({ length: 21 }, (_, i) => point(0.45 + i * 0.001)) }] };
    const crop = (p: Landmark) => ({ ...p, x: 0.5 + (p.x - 0.5) * (4 / 3) / (width / height) });
    const portrait = { ...landscape, width, height, pose: pose.map(crop),
      hands: landscape.hands.map((h) => ({ ...h, landmarks: h.landmarks.map(crop) })) };
    const expected = packCitizenLandmarks(landscape);
    const actual = packCitizenLandmarks(portrait);
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
    expect(actual.slice(34).every((v) => v === 0)).toBe(true); // missing hand remains missing
    expect(packCitizenLandmarks({ ...portrait, hands: [], pose: pose.map(() => ({ x: 0, y: 0, z: 0 })) })
      .every((v) => v === 0)).toBe(true);
  });

  it('bounds clip duration and rejects malformed/absent shoulder inputs', () => {
    expect(() => createCitizenModelInput(samples().slice(0, 2))).toThrow();
    expect(() => createCitizenModelInput(samples().reverse())).toThrow();
    expect(() => createCitizenModelInput(samples().map((s) => ({ ...s, landmarks: new Float32Array(54) })))).toThrow(/shoulders/i);
    expect(() => createCitizenModelInput(samples().map((s) => ({ ...s, timestampMs: s.timestampMs * 8 })))).toThrow(/five seconds/i);
  });
});

describe('anatomical second recognition view', () => {
  const { mirrorCitizenSamples } = jest.requireActual('../../src/recognition/citizen-recognition');
  it('mirrors coordinates and swaps anatomical sides before normalization, preserving absent joints', () => {
    const original = samples();
    original[0].landmarks.fill(0, 34); // missing right hand
    const source = original.map((s) => Array.from(s.landmarks));
    const mirrored = mirrorCitizenSamples(original);
    expect(mirrored[0].timestampMs).toBe(original[0].timestampMs);
    expect(Array.from(mirrored[0].landmarks.slice(14, 34))).toEqual(Array(20).fill(0));
    expect(mirrored[0].landmarks[34]).toBeCloseTo(1 - original[0].landmarks[14]);
    expect(mirrored[0].landmarks[35]).toBeCloseTo(original[0].landmarks[15]);
    expect(mirrored[0].landmarks[6]).toBeCloseTo(1 - original[0].landmarks[8]);
    expect(original.map((s) => Array.from(s.landmarks))).toEqual(source);
    const restored = mirrorCitizenSamples(mirrored);
    restored.forEach((s: { landmarks: Float32Array }, i: number) => s.landmarks.forEach((v, j) => expect(v).toBeCloseTo(source[i][j], 6)));
    expect(createCitizenModelInput(mirrored).every(Number.isFinite)).toBe(true);
    expect(original.length).toBe(restored.length);
  });
  it('rejects malformed inputs instead of silently mirroring the wrong joint layout', () => {
    expect(() => mirrorCitizenSamples([{ timestampMs: 1, landmarks: new Float32Array(164) }])).toThrow(/invalid/i);
    expect(() => mirrorCitizenSamples([{ timestampMs: 1, landmarks: new Float32Array(54).fill(NaN) }])).toThrow(/invalid/i);
  });
}); 

