import { BASELINE_VERSION, emptyDataset, evaluateExamples, exampleLabel, refineCandidates, trainPersonalRanker, validCandidates, validDataset, type RecognitionExample } from '../../src/recognition/recognition-examples';
import { SIGN_FEATURE_WIDTH, type SignSequence } from '../../src/recognition/sign-features';

function example(id: number, label: string | null, value: number, split: 'train' | 'test' = 'train'): RecognitionExample {
  const durationMs = 1000 + id;
  const sequence: SignSequence = { version: 1, durationMs, frames: Array.from({ length: 24 }, (_, i) => ({ timestampMs: durationMs * i / 23,
    values: Array<number>(SIGN_FEATURE_WIDTH * 2).fill(value), mask: Array<number>(SIGN_FEATURE_WIDTH * 2).fill(1) })) };
  return { id: String(id), label, signer: 'me', session: split, split, createdAt: '2026-10-25', baselineVersion: BASELINE_VERSION, sequence,
    baseline: ['HELLO', 'HELP', 'WATER'], displayed: ['HELLO', 'HELP', 'WATER'],
    diagnostics: { frames: 30, fps: 30, maxGapMs: 34, handCoverage: 1, faceCoverage: 1, inferenceMs: 30 } };
}
const training = () => ({ ...emptyDataset(), examples: [example(0, 'HELLO', 0), example(1, 'HELLO', 0.005), example(2, 'HELLO', 0.01),
  example(3, 'WATER', 0.4), example(4, 'WATER', 0.405), example(5, 'WATER', 0.41)] });

describe('local example learning and honest evaluation', () => {
  it('learns one new personal word from three examples without changing the built-in vocabulary', async () => {
    const data = { ...emptyDataset(), examples: [example(0, 'MY NAME', 0.3), example(1, 'MY NAME', 0.305), example(2, 'MY NAME', 0.31)] };
    expect(validDataset(data)).toBe(true);
    const ranker = await trainPersonalRanker(data, 'me');
    const choices = refineCandidates(example(10, 'MY NAME', 0.303, 'test'), ranker);
    expect(choices).toEqual(['MY NAME', 'HELLO', 'HELP']);
    expect(validCandidates(choices)).toBe(false); // Built-in predictions remain restricted to the 500 words.
    const different = example(11, null, 0.6, 'test');
    expect(refineCandidates(different, ranker)).toEqual(different.baseline);
    await expect(trainPersonalRanker({ ...data, examples: data.examples.slice(0, 2) }, 'me')).rejects.toThrow(/three training/);
  });
  it('normalizes personal labels, reserves UNKNOWN, and validates profile and saved custom suggestions', () => {
    expect(exampleLabel('  my   name  ')).toBe('MY NAME');
    expect(exampleLabel('moon')).toBe('MOON');
    expect(exampleLabel('UNKNOWN')).toBeNull();
    expect(exampleLabel('a'.repeat(41))).toBeNull();
    expect(exampleLabel('<script>')).toBeNull();
    const e = example(1, 'MY NAME', 0.1); e.displayed = ['MY NAME', 'HELLO', 'HELP'];
    expect(validDataset({ version: 1, examples: [e], profile: { signer: 'me', enabled: true } })).toBe(true);
    expect(validDataset({ version: 1, examples: [e], profile: { signer: 'me', enabled: 'yes' } })).toBe(false);
    e.baseline = e.displayed;
    expect(validDataset({ version: 1, examples: [e] })).toBe(false);
  });
  it('learns distinct temporal prototypes and retains exactly three supported choices', async () => {
    const ranker = await trainPersonalRanker(training(), 'me');
    expect(ranker.calibration).toHaveLength(2);
    const result = refineCandidates(example(10, 'WATER', 0.402, 'test'), ranker);
    expect(result).toEqual(['WATER', 'HELLO', 'HELP']);
    expect(refineCandidates(example(11, 'WATER', 0.402, 'test'), null)).toEqual(['HELLO', 'HELP', 'WATER']);
    expect(refineCandidates(example(12, null, 2, 'test'), ranker)).toEqual(['HELLO', 'HELP', 'WATER']);
  });
  it('retains distinct old and new gesture versions of HELLO and emits one canonical word', async () => {
    const examples = [0, 1, 2].map((i) => ({ ...example(i, 'HELLO', i * 0.005), variantId: 'hello-original' }));
    examples.push(...[3, 4, 5].map((i) => ({ ...example(i, 'HELLO', 0.4 + (i - 3) * 0.005), variantId: 'hello-new' })));
    const ranker = await trainPersonalRanker({ ...emptyDataset(), examples }, 'me');
    expect(ranker.variants).toHaveLength(2); expect(ranker.examples).toHaveLength(6);
    expect(ranker.calibration).toHaveLength(2);
    for (const value of [0.002, 0.402]) {
      const test = example(10, 'HELLO', value, 'test'); test.baseline = ['FOREST', 'PILLOW', 'CLOUD'];
      const choices = refineCandidates(test, ranker);
      expect(choices).toEqual(['HELLO', 'FOREST', 'PILLOW']);
      expect(new Set(choices).size).toBe(3);
    }
    const unrelated = example(11, 'HELLO', 0.9, 'test'); unrelated.baseline = ['FOREST', 'PILLOW', 'CLOUD'];
    expect(refineCandidates(unrelated, ranker)).toEqual(unrelated.baseline);
  });
  it('keeps legacy examples for training while requiring fresh baseline tests after the ranking change', async () => {
    const old = training(); old.examples.forEach((e) => { e.baselineVersion = 'citizen-two-view-wlasl-common500-strict-v1'; });
    expect(validDataset(old)).toBe(true);
    const ranker = await trainPersonalRanker(old, 'me');
    expect(ranker.variants).toHaveLength(2);
    old.examples.push({ ...example(10, 'HELLO', 0, 'test'), baselineVersion: 'citizen-two-view-wlasl-common500-strict-v1' });
    await expect(evaluateExamples(old, ranker)).rejects.toThrow(/Record fresh test/);
  });
  it('never learns from test examples or another signer', async () => {
    const data = { ...emptyDataset(), examples: training().examples.map((e) => ({ ...e, split: 'test' as const })) };
    await expect(trainPersonalRanker(data, 'me')).rejects.toThrow(/three training/);
    await expect(trainPersonalRanker(training(), 'someone-else')).rejects.toThrow(/three training/);
    const trained = await trainPersonalRanker({ ...training(), examples: [...training().examples, example(20, 'HELP', 0.403, 'test')] }, 'me');
    expect(trained.examples.map((e) => e.id)).not.toContain('20');
  });
  it('keeps user-defined overlapping meanings as choices and retains the baseline for poor tracking', async () => {
    const ambiguous = training(); ambiguous.examples = ambiguous.examples.map((e, i) => example(i, e.label, 0));
    const overlapping = await trainPersonalRanker(ambiguous, 'me');
    expect(overlapping.calibration).toHaveLength(2);
    expect(refineCandidates(example(10, null, 0, 'test'), overlapping)).toEqual(['HELLO', 'WATER', 'HELP']);
    const ranker = await trainPersonalRanker(training(), 'me');
    const poor = example(10, 'WATER', 0.4, 'test'); poor.diagnostics.maxGapMs = 600;
    poor.sequence.frames.slice(3, 20).forEach((frame) => { frame.mask.fill(0); frame.values.fill(0); });
    expect(refineCandidates(poor, ranker)).toEqual(poor.baseline);
  });
  it('can learn a synonym when no pretrained predictions were available', async () => {
    const examples = [0, 1, 2].map((i) => ({ ...example(i, 'HELLO', i * 0.005), baseline: [], displayed: [], variantId: 'user-hello' }));
    const data = { ...emptyDataset(), examples };
    expect(validDataset(data)).toBe(true);
    const ranker = await trainPersonalRanker(data, 'me');
    const fresh = example(10, 'HELLO', 0.003, 'test'); fresh.baseline = ['FOREST', 'PILLOW', 'CLOUD'];
    expect(refineCandidates(fresh, ranker)).toEqual(['HELLO', 'FOREST', 'PILLOW']);
  });
  it('reports held-out top-one/top-three, confusions and regressions without an invented accuracy result', async () => {
    await expect(evaluateExamples(training(), null)).rejects.toThrow(/Record test/);
    const ranker = await trainPersonalRanker(training(), 'me');
    const data = { ...training(), examples: [...training().examples, example(10, 'WATER', 0.402, 'test'), example(11, 'HELLO', 0.002, 'test'),
      example(12, 'HELLO', 0.402, 'test'), example(13, null, 0.402, 'test')] };
    const report = await evaluateExamples(data, ranker);
    expect(report.known).toBe(3); expect(report.unknown).toBe(1);
    expect(report.baselineTop1).toBeCloseTo(2 / 3); expect(report.personalTop1).toBeCloseTo(2 / 3);
    expect(report.improved).toBe(1); expect(report.regressed).toBe(1); expect(report.unknownPromotions).toBe(1);
    expect(report.confusions).toEqual([{ expected: 'HELLO', predicted: 'WATER', count: 1 }]);
  });
  it('rejects duplicate captures and session leakage', async () => {
    const data = training(); const test = example(10, 'WATER', 0.402, 'test');
    test.session = 'train'; data.examples.push(test);
    await expect(evaluateExamples(data, null)).rejects.toThrow(/overlap/);
    test.session = 'test'; test.sequence = data.examples[0].sequence;
    await expect(evaluateExamples(data, null)).rejects.toThrow(/overlap/);
    expect(validDataset({ ...data, examples: [...data.examples, data.examples[0]] })).toBe(false);
    expect(validDataset({ version: 1, examples: [null] })).toBe(false);
    const invalid = example(20, 'made-up-label', 0);
    expect(validDataset({ version: 1, examples: [invalid] })).toBe(false);
  });
});
