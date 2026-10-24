import { createWordModelInput, decodeWordPrediction, LANDMARKS_PER_FRAME, packWordLandmarks, WORD_MODEL_FRAMES, WORD_MODEL_LABELS, WordSegmenter } from '../../src/recognition/asl-word-recognition';
import type { TrackingFrame } from '../../src/recognition/landmarks';
import { initialTranscriptState, transcriptReducer } from '../../src/state/transcript-state';

function frame(timestampMs: number, hands = true): TrackingFrame {
  const points = (count: number, x: number) => Array.from({ length: count }, () => ({ x, y: 0.5, z: 0 }));
  return { timestampMs, width: 480, height: 640, inferenceMs: 25,
    face: points(478, 0.1), pose: points(33, 0.2), blendshapes: {},
    hands: hands ? [{ side: 'Left', score: 0.99, landmarks: points(21, 0.3) },
      { side: 'Right', score: 0.98, landmarks: points(21, 0.4) }] : [] };
}

function capture(segmenter: WordSegmenter, offset = 0) {
  for (let t = 0; t <= 800; t += 100) expect(segmenter.accept(frame(t + offset)).kind).toBe('tracking');
  for (let t = 900; t <= 1400; t += 100) expect(segmenter.accept(frame(t + offset, false)).kind).toBe('idle');
  return segmenter.accept(frame(1500 + offset, false));
}

describe('pretrained ASL word input and scores', () => {
  it('maps face, left hand, pose and right hand to the original 543-point tensor', () => {
    const packed = packWordLandmarks(frame(0));
    expect(packed).toHaveLength(543 * 3);
    expect(packed[467 * 3]).toBeCloseTo(0.1);
    expect(packed[468 * 3]).toBeCloseTo(0.3);
    expect(packed[489 * 3]).toBeCloseTo(0.2);
    expect(packed[522 * 3]).toBeCloseTo(0.4);
    expect(packed[542 * 3]).toBeCloseTo(0.4);
    // Missing hands are NaN, never invented zero coordinates.
    const absent = packWordLandmarks(frame(0, false));
    expect(Number.isNaN(absent[468 * 3])).toBe(true);
    expect(Number.isNaN(absent[522 * 3])).toBe(true);
  });

  it('resamples by timestamps, preserves missing data and retains the first and last positions', () => {
    const samples = [0, 100, 400, 1000].map((timestampMs) => {
      const landmarks = new Float32Array(LANDMARKS_PER_FRAME * 3).fill(NaN);
      landmarks[0] = timestampMs / 1000;
      return { timestampMs, landmarks };
    });
    const input = createWordModelInput(samples);
    expect(input).toHaveLength(WORD_MODEL_FRAMES * 543 * 3);
    expect(input[0]).toBe(0);
    expect(input[31 * 543 * 3]).toBe(1);
    expect(input[16 * 543 * 3]).toBeCloseTo(16 / 31);
    expect(Number.isNaN(input[1])).toBe(true);
    expect(() => createWordModelInput(samples.slice(0, 2))).toThrow();
    expect(() => createWordModelInput([...samples].reverse())).toThrow();
  });

  it('decodes logits using the packaged label indices and rejects uncertain/nonfinite results', () => {
    expect(WORD_MODEL_LABELS).toHaveLength(250);
    const logits = new Float32Array(250).fill(-4);
    const index = WORD_MODEL_LABELS.indexOf('hello');
    expect(index).toBeGreaterThanOrEqual(0);
    logits[index] = 8;
    expect(decodeWordPrediction(logits)?.label).toBe('HELLO');
    expect(decodeWordPrediction(new Float32Array(250))).toBeNull();
    logits[(index + 1) % 250] = 8;
    expect(decodeWordPrediction(logits)).toBeNull();
    logits[0] = NaN;
    expect(() => decodeWordPrediction(logits)).toThrow();
    expect(() => decodeWordPrediction(new Float32Array(27))).toThrow();
  });
});

describe('isolated words into the transcript', () => {
  it('commits one clip per hands-out boundary and permits intentional repeated words', () => {
    const segmenter = new WordSegmenter();
    const first = capture(segmenter);
    expect(first.kind).toBe('complete');
    expect(segmenter.accept(frame(1600, false)).kind).toBe('idle');
    const second = capture(segmenter, 1800);
    expect(second.kind).toBe('complete');
    let transcript = initialTranscriptState;
    for (const result of [first, second]) {
      if (result.kind !== 'complete') throw new Error('Expected sign clip');
      expect(createWordModelInput(result.samples)).toHaveLength(32 * 543 * 3);
      const scores = new Float32Array(250).fill(-5);
      scores[WORD_MODEL_LABELS.indexOf('hello')] = 8;
      const prediction = decodeWordPrediction(scores);
      if (prediction) transcript = transcriptReducer(transcript, { type: 'append-word', value: prediction.label });
    }
    expect(transcript.value).toBe('HELLO HELLO');
    expect(transcriptReducer(transcript, { type: 'undo' }).value).toBe('HELLO');
  });

  it('manual finish emits once and waits for a hands-out reset', () => {
    const segmenter = new WordSegmenter();
    for (let t = 0; t <= 800; t += 100) segmenter.accept(frame(t));
    expect(segmenter.finish().kind).toBe('complete');
    expect(segmenter.finish().kind).toBe('idle');
    expect(segmenter.accept(frame(900)).kind).toBe('idle');
    for (let t = 1000; t <= 1600; t += 100) segmenter.accept(frame(t, false));
    expect(segmenter.accept(frame(1700)).kind).toBe('tracking');
  });

  it('does not require body anchors, but explains missing facial landmarks', () => {
    const segmenter = new WordSegmenter();
    expect(segmenter.accept({ ...frame(0), pose: [] }).kind).toBe('tracking');
    expect(segmenter.accept({ ...frame(100), face: [] }).kind).toBe('face-missing');
    segmenter.reset();
    expect(segmenter.finish().kind).toBe('idle');
  });

  it('discards overlong, too-short and interrupted clips instead of producing words', () => {
    const segmenter = new WordSegmenter();
    segmenter.accept(frame(0));
    expect(segmenter.finish().kind).toBe('too-short');
    segmenter.reset();
    for (let t = 0; t <= 5000; t += 100) segmenter.accept(frame(t));
    expect(segmenter.accept(frame(5100)).kind).toBe('too-long');
    expect(segmenter.finish().kind).toBe('idle');
    segmenter.reset();
    segmenter.accept(frame(0));
    expect(segmenter.accept(frame(1000)).kind).toBe('interrupted');
    expect(segmenter.finish().kind).toBe('idle');
  });
}); 

