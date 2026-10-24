import { createExpandedModelInput, EXPANDED_WORD_LABELS, packExpandedLandmarks } from '../../src/recognition/asl1000-recognition';
import { decodeWordPrediction, WordSegmenter } from '../../src/recognition/asl-word-recognition';
import type { TrackingFrame } from '../../src/recognition/landmarks';

function frame(timestampMs: number): TrackingFrame {
  return { timestampMs, width: 480, height: 640, face: [], blendshapes: {}, inferenceMs: 30,
    pose: Array.from({ length: 33 }, (_, i) => ({ x: i / 40, y: 0.6, z: 0, visibility: 1 })),
    hands: [{ side: 'Left', score: 0.99, landmarks: Array.from({ length: 21 }, () => ({ x: 0.25, y: 0.5, z: 0 })) }] };
}

describe('1,000-sign TGCN input', () => {
  it('packs the original 13 upper-body joints followed by left and right hands', () => {
    const packed = packExpandedLandmarks(frame(0));
    expect(packed).toHaveLength(110);
    expect(packed[0]).toBe(-1); // nose
    expect(packed[2]).toBeCloseTo(2 * (11.5 / 40) - 1); // neck = shoulder midpoint
    expect(packed[4]).toBeCloseTo(2 * (12 / 40) - 1); // right shoulder
    expect(packed[16]).toBeCloseTo(2 * (23.5 / 40) - 1); // pelvis midpoint
    expect(packed[26]).toBe(-0.5); // left wrist, first hand point
    expect(packed[68]).toBe(-1); // absent right hand, original missing-point sentinel
    expect(packed.every(Number.isFinite)).toBe(true);
  });

  it('uses joint-major temporal XY layout and preserves sequence endpoints', () => {
    const samples = [0, 100, 400, 1000].map((timestampMs) => ({ timestampMs,
      landmarks: new Float32Array(110).fill(timestampMs / 1000) }));
    const input = createExpandedModelInput(samples);
    expect(input).toHaveLength(5500);
    expect(input[0]).toBe(0);
    expect(input[98]).toBe(1);
    expect(input[100]).toBe(0); // next joint starts at frame zero
    expect(input[198]).toBe(1);
    expect(() => createExpandedModelInput(samples.slice(0, 2))).toThrow();
    expect(() => createExpandedModelInput([...samples].reverse())).toThrow();
    expect(() => createExpandedModelInput([{ ...samples[0], landmarks: new Float32Array(1629) }, ...samples.slice(1)])).toThrow();
  });

  it('interpolates observed motion at camera frame rates without inventing missing joints', () => {
    const samples = [0, 100, 200, 300, 400, 500].map((timestampMs) => ({ timestampMs,
      landmarks: new Float32Array(110).fill(timestampMs / 1000) }));
    const smooth = createExpandedModelInput(samples);
    expect(smooth[2]).toBeCloseTo(0.5 / 49); // 10.2 ms, between actual observations
    expect(smooth[48]).toBeCloseTo(0.5 * 24 / 49);
    // A temporary missing hand must stay missing or observed, never drift toward -1.
    samples[1].landmarks[26] = -1; samples[1].landmarks[27] = -1;
    const missing = createExpandedModelInput(samples);
    const jointStart = 13 * 100;
    expect(missing[jointStart + 10]).toBe(-1); // nearest observation at 100 ms
    expect(missing[jointStart + 2]).toBe(0); // nearest observation at 0 ms
  });

  it('uses exactly 1,000 unique lexicographic classes and the selected vocabulary for decoding', () => {
    expect(EXPANDED_WORD_LABELS).toHaveLength(1000);
    expect(new Set(EXPANDED_WORD_LABELS).size).toBe(1000);
    expect([...EXPANDED_WORD_LABELS].sort()).toEqual(EXPANDED_WORD_LABELS);
    expect(EXPANDED_WORD_LABELS).toContain('help');
    const scores = new Float32Array(1000).fill(-8);
    scores[EXPANDED_WORD_LABELS.indexOf('help')] = 8;
    expect(decodeWordPrediction(scores, EXPANDED_WORD_LABELS)?.label).toBe('HELP');
    expect(decodeWordPrediction(new Float32Array(1000), EXPANDED_WORD_LABELS)).toBeNull();
    expect(() => decodeWordPrediction(scores)).toThrow(); // protect against the 250-label map
  });

  it('segments expanded-model clips using body context without requiring face mesh', () => {
    const segmenter = new WordSegmenter(packExpandedLandmarks, (f) => f.pose.length === 33);
    for (let t = 0; t <= 800; t += 100) expect(segmenter.accept(frame(t)).kind).toBe('tracking');
    const result = segmenter.finish();
    expect(result.kind).toBe('complete');
    if (result.kind === 'complete') expect(createExpandedModelInput(result.samples)).toHaveLength(5500);
    expect(segmenter.finish().kind).toBe('idle');
  });
}); 

