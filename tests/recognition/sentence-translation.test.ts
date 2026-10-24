import pieces from '../../assets/models/asl_sentence_tokens.json';
import { chooseSentenceToken, sentenceTokensToText, translateSentence, type LocalModel } from '../../src/recognition/sentence-decoder';
import { packSentenceFrame, SentenceCapture, SENTENCE_FACE_POINTS, SENTENCE_FEATURES, SENTENCE_FRAMES, SENTENCE_TOKENS } from '../../src/recognition/sentence-input';
import type { TrackingFrame } from '../../src/recognition/landmarks';

function frame(time: number, hands = true): TrackingFrame {
  const points = (count: number) => Array.from({ length: count }, (_, i) => ({
    x: 0.3 + (i % 7) * 0.04 + Math.sin(time / 200 + i) * 0.04,
    y: 0.25 + (i % 9) * 0.035 + Math.cos(time / 300 + i) * 0.04, z: 0, visibility: 1,
  }));
  const pose = points(33); pose[11] = { x: 0.3, y: 0.5, z: 0, visibility: 1 };
  pose[12] = { x: 0.7, y: 0.5, z: 0, visibility: 1 };
  return { timestampMs: time, width: 480, height: 640, face: points(478), pose, blendshapes: {}, inferenceMs: 40,
    hands: hands ? [{ side: 'Left', score: 0.99, landmarks: points(21) }] : [] };
}

function models(sequence: number[]) {
  let cursor = 0;
  const encoder: LocalModel = {
    inputs: [{ name: 'mask', shape: [1, 96], dataType: 'float32' }, { name: 'features', shape: [1, 96, 208], dataType: 'float32' }],
    run: jest.fn(async () => [new Float32Array(96 * 768).buffer]),
  };
  const decoder: LocalModel = {
    // Deliberately shuffled input order, matching tensor names rather than assumed indices.
    inputs: [
      { name: 'position', shape: [1], dataType: 'int32' },
      { name: 'tokens', shape: [1, SENTENCE_TOKENS], dataType: 'int32' },
      { name: 'mask', shape: [1, 96], dataType: 'float32' },
      { name: 'hidden', shape: [1, 96, 768], dataType: 'float32' },
    ],
    run: jest.fn(async () => {
      const logits = new Float32Array(32128).fill(-20); logits[sequence[cursor++] ?? 1] = 20;
      return [logits.buffer];
    }),
  };
  return { encoder, decoder };
}

describe('whole-sentence landmark input', () => {
  it('packs the reference 104 XY points, and rejects missing face/body context', () => {
    expect(SENTENCE_FACE_POINTS).toHaveLength(37);
    const input = packSentenceFrame(frame(0))!;
    expect(input).toHaveLength(208);
    expect(input.every(Number.isFinite)).toBe(true);
    // No right hand: its local-box sentinel is -1; left-hand slot follows it.
    expect(Array.from(input.slice(50, 92))).toEqual(Array(42).fill(-1));
    expect(input[11 * 2]).toBeCloseTo(-1 / 3); // left shoulder relative to shoulder center
    expect(packSentenceFrame({ ...frame(0), face: [] })).toBeNull();
    expect(packSentenceFrame({ ...frame(0), pose: [] })).toBeNull();
  });

  it('captures continuous signing across a hands-out pause and creates an attention mask', () => {
    const capture = new SentenceCapture();
    for (let t = 0; t <= 3000; t += 125) {
      const pause = t >= 1000 && t <= 1625;
      expect(capture.accept(frame(t, !pause))).toBe('capturing');
    }
    const input = capture.finish();
    expect(input.features).toHaveLength(SENTENCE_FRAMES * SENTENCE_FEATURES);
    expect(Array.from(input.mask.slice(0, 25))).toEqual(Array(25).fill(1));
    expect(input.mask.slice(25).every((v) => v === 0)).toBe(true);
    expect(() => capture.finish()).toThrow(/two seconds/i);
  });

  it('rejects empty, stationary, mostly invisible, and interrupted recordings', () => {
    const capture = new SentenceCapture();
    expect(() => capture.finish()).toThrow();
    for (let t = 0; t <= 2500; t += 125) capture.accept({ ...frame(0), timestampMs: t });
    expect(() => capture.finish()).toThrow(/movement/i);
    for (let t = 0; t <= 2500; t += 125) capture.accept(frame(t, false));
    expect(() => capture.finish()).toThrow(/visible/i);
    capture.accept(frame(0)); expect(capture.accept(frame(1000))).toBe('interrupted');
    expect(() => capture.finish()).toThrow(/interrupted/i);
  });

  it('bounds recording length without silently splitting one sentence into words', () => {
    const capture = new SentenceCapture();
    for (let t = 0; t < 12000; t += 125) expect(capture.accept(frame(t))).toBe('capturing');
    expect(capture.accept(frame(12000))).toBe('limit');
    expect(capture.finish().mask.reduce((a, b) => a + b, 0)).toBe(96);
  });

  it('masks missing face/body frames rather than treating zero placeholders as observations', () => {
    const capture = new SentenceCapture();
    for (let t = 0; t <= 3000; t += 125) {
      const missing = t >= 1000 && t <= 1375;
      capture.accept(missing ? { ...frame(t), face: [] } : frame(t));
    }
    const input = capture.finish();
    expect(Array.from(input.mask.slice(8, 12))).toEqual([0, 0, 0, 0]);
    expect(input.features.slice(8 * 208, 12 * 208).every((v) => v === 0)).toBe(true);
    expect(input.mask[12]).toBe(1);
  });

  it('preserves elapsed time when native inference produces frames more slowly than 8 Hz', () => {
    const capture = new SentenceCapture();
    for (let t = 0; t <= 3000; t += 200) capture.accept(frame(t));
    const input = capture.finish();
    expect(input.mask.slice(0, 25).every((v) => v === 1)).toBe(true);
    expect(input.mask.slice(25).every((v) => v === 0)).toBe(true);
    // At 1 s the nearest source observation is 1 s, not event index 8 (1.6 s).
    expect(Array.from(input.features.slice(8 * 208, 9 * 208)))
      .toEqual(Array.from(packSentenceFrame(frame(1000))!));
  });

  it.each([80, 33])('captures twelve seconds at a %i ms frame interval without early cutoff', (interval) => {
    const capture = new SentenceCapture();
    for (let t = 0; t < 12000; t += interval) expect(capture.accept(frame(t))).toBe('capturing');
    expect(capture.accept(frame(12000))).toBe('limit');
    expect(capture.finish().mask.reduce((a, b) => a + b, 0)).toBe(96);
  });

  it.each([33, 125, 200])('does not label the same slow movement stationary at a %i ms interval', (interval) => {
    const capture = new SentenceCapture();
    const base = frame(0);
    for (let t = 0; t <= 3000; t += interval) {
      capture.accept({ ...base, timestampMs: t,
        pose: base.pose.map((p, i) => i === 11 || i === 12 ? p : { ...p, x: p.x + t * 0.0001 }) });
    }
    expect(() => capture.finish()).not.toThrow();
  });
});

describe('trained local autoregressive sentence decoder', () => {
  const hello = pieces.indexOf('▁Hello'); const world = pieces.indexOf('▁world'); const period = pieces.indexOf('.');
  const input = { features: new Float32Array(96 * 208), mask: new Float32Array(96).fill(1) };

  it('decodes the checkpoint SentencePiece vocabulary and rejects unknown/special tokens', () => {
    expect(hello).toBeGreaterThan(2); expect(world).toBeGreaterThan(2);
    expect(sentenceTokensToText([hello, world, period])).toBe('Hello world.');
    expect(() => sentenceTokensToText([2])).toThrow();
    expect(() => sentenceTokensToText([32000])).toThrow();
  });

  it('runs an encoder then ordered decoder steps to EOS, using tensor names and integer token buffers', async () => {
    const runtime = models([hello, world, period, 1]); const progress = jest.fn();
    await expect(translateSentence(runtime, input, () => true, progress)).resolves.toBe('Hello world.');
    expect(runtime.encoder.run).toHaveBeenCalledTimes(1);
    expect(runtime.decoder.run).toHaveBeenCalledTimes(4);
    const calls = (runtime.decoder.run as jest.Mock).mock.calls;
    expect(new Int32Array(calls[1][0][0])[0]).toBe(1);
    expect(new Int32Array(calls[1][0][1])[1]).toBe(hello);
    expect(progress).toHaveBeenCalledTimes(3);
  });

  it('drops results when a session is cancelled, and never decodes stale encoder output', async () => {
    const runtime = models([hello, 1]); let current = true;
    runtime.encoder.run = jest.fn(async () => { current = false; return [new Float32Array(96 * 768).buffer]; });
    await expect(translateSentence(runtime, input, () => current, jest.fn())).rejects.toThrow(/cancelled/i);
    expect(runtime.decoder.run).not.toHaveBeenCalled();
  });

  it('rejects empty, malformed, uncertain and truncated translations instead of adding invented text', async () => {
    await expect(translateSentence(models([1]), input, () => true, jest.fn())).rejects.toThrow(/uncertain/i);
    const invalid = models([hello]); invalid.decoder.run = async () => [new Float32Array([NaN]).buffer];
    await expect(translateSentence(invalid, input, () => true, jest.fn())).rejects.toThrow(/invalid/i);
    const uncertain = models([hello]); uncertain.decoder.run = jest.fn(async () => {
      const logits = new Float32Array(32128); logits[(uncertain.decoder.run as jest.Mock).mock.calls.length === 1 ? hello : 1] = 0.001;
      return [logits.buffer];
    });
    await expect(translateSentence(uncertain, input, () => true, jest.fn())).rejects.toThrow(/uncertain/i);
    const long = models([]); let step = 0; long.decoder.run = async () => {
      const logits = new Float32Array(32128).fill(-10); logits[100 + step++] = 10; return [logits.buffer];
    };
    await expect(translateSentence(long, input, () => true, jest.fn())).rejects.toThrow(/too long/i);
  });

  it('blocks repeated trigrams and reserved output IDs', () => {
    const logits = new Float32Array(32128).fill(-10); logits[7] = 5; logits[1] = 4; logits[32000] = 20;
    expect(chooseSentenceToken(logits, [5, 6, 7, 5, 6]).token).toBe(1);
  });
}); 

