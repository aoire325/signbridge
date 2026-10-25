import { RECOGNITION_WORD_LABELS } from './expanded-vocabulary';
import { richSequenceDistance, sufficientSignTracking, validSignSequence, type SignSequence } from './sign-features';

export const EXAMPLE_SCHEMA = 1;
export const BASELINE_VERSION = 'citizen-two-view-wlasl-common500-strict-v2';
const LEGACY_BASELINE_VERSION = 'citizen-two-view-wlasl-common500-strict-v1';
export const MAX_EXAMPLES = 120;
export const MAX_TRAINING_EXAMPLES = 24;
const vocabulary = new Set<string>(RECOGNITION_WORD_LABELS);
export type CaptureDiagnostics = { frames: number; fps: number; maxGapMs: number; handCoverage: number; faceCoverage: number; inferenceMs: number };
export type RecognitionCapture = { sequence: SignSequence; baseline: string[]; displayed: string[]; diagnostics: CaptureDiagnostics;
  evidence?: { primary: string[]; mirrored: string[]; secondary: string[] } };
export type RecognitionExample = RecognitionCapture & {
  id: string; label: string | null; signer: string; session: string; split: 'train' | 'test'; createdAt: string; baselineVersion: string; variantId?: string;
};
export type ExampleDataset = { version: 1; examples: RecognitionExample[]; profile?: { signer: string; enabled: boolean } };
export const emptyDataset = (): ExampleDataset => ({ version: EXAMPLE_SCHEMA, examples: [] });
export function exampleLabel(text: string): string | null {
  const label = text.trim().replace(/\s+/g, ' ').toUpperCase();
  return label.length > 0 && label.length <= 40 && label !== 'UNKNOWN' && /^[\p{L}\p{N}][\p{L}\p{N} '\u2019-]*$/u.test(label) ? label : null;
}
export function validCandidates(labels: unknown): labels is string[] {
  return Array.isArray(labels) && labels.length === 3 && new Set(labels).size === 3 && labels.every((label) => vocabulary.has(label));
}
export function validDataset(value: unknown): value is ExampleDataset {
  const data = value as ExampleDataset;
  return !!data && data.version === EXAMPLE_SCHEMA && Array.isArray(data.examples) && data.examples.length <= MAX_EXAMPLES
    && (data.profile === undefined || !!data.profile && typeof data.profile.signer === 'string' && data.profile.signer.length > 0
      && data.profile.signer.length <= 60 && typeof data.profile.enabled === 'boolean')
    && new Set(data.examples.map((e) => e?.id)).size === data.examples.length
    && data.examples.every((e) => e && [e.id, e.signer, e.session, e.createdAt].every((s) => typeof s === 'string' && s.length > 0 && s.length <= 100)
      && (e.label === null || typeof e.label === 'string' && exampleLabel(e.label) === e.label) && (e.split === 'train' || e.split === 'test')
      && [BASELINE_VERSION, LEGACY_BASELINE_VERSION].includes(e.baselineVersion)
      && (e.variantId === undefined || typeof e.variantId === 'string' && e.variantId.length > 0 && e.variantId.length <= 100)
      && validSignSequence(e.sequence) && Array.isArray(e.baseline) && (e.baseline.length === 0 || validCandidates(e.baseline))
      && Array.isArray(e.displayed) && e.displayed.length === (e.baseline.length ? 3 : 0) && new Set(e.displayed).size === e.displayed.length
      && e.displayed.every((label) => typeof label === 'string' && exampleLabel(label) === label)
      && (e.evidence === undefined || !!e.evidence && ['primary', 'mirrored', 'secondary'].every((source) => {
        const leaders = e.evidence![source as keyof NonNullable<RecognitionCapture['evidence']>];
        return Array.isArray(leaders) && leaders.length === 3 && leaders.every((word) => typeof word === 'string' && word.length > 0 && word.length <= 100);
      }))
      && e.diagnostics && Object.values(e.diagnostics).every((n) => Number.isFinite(n) && n >= 0)
      && ['frames', 'fps', 'maxGapMs', 'handCoverage', 'faceCoverage', 'inferenceMs'].every((key) => Number.isFinite(e.diagnostics[key as keyof CaptureDiagnostics]))
      && e.diagnostics.handCoverage <= 1 && e.diagnostics.faceCoverage <= 1);
}
export function usableCapture(capture: RecognitionCapture): boolean {
  return captureSaveIssue(capture) === null;
}

/** Validate tracked observations, not signing correctness or phone speed. A
 * short sign's lead-in/ending can legitimately contain mostly hands-out frames.
 */
export function captureSaveIssue(capture: RecognitionCapture): string | null {
  if (!validSignSequence(capture.sequence)) return 'The recording could not be read. Record the gesture again with your hands and shoulders visible.';
  if (!Number.isFinite(capture.diagnostics.frames) || capture.diagnostics.frames < 4) return 'Too little movement was captured. Record the gesture for at least half a second.';
  if (!Number.isFinite(capture.diagnostics.handCoverage) || capture.diagnostics.handCoverage * capture.diagnostics.frames + 1e-6 < 3) return 'Your hands were not tracked long enough. Keep them visible while recording the gesture.';
  if (!sufficientSignTracking(capture.sequence)) return 'Too much tracking is missing from this recording. Keep your hands and shoulders visible while recording again.';
  return null;
}

type ClassCalibration = { variant: string; label: string; maxDistance: number };
export type PersonalVariant = { id: string; label: string; examples: RecognitionExample[] };
export type PersonalRanker = { examples: RecognitionExample[]; variants: PersonalVariant[]; calibration: ClassCalibration[]; signer: string };
export const personalVariantKey = (label: string, id: string) => JSON.stringify([label, id]);

/** Explicit variant IDs preserve each saved gesture pattern. Older records are
 * retained as groups of three within their original word/session, never relabeled.
 */
export function personalVariants(dataset: ExampleDataset, signer: string): PersonalVariant[] {
  const groups = new Map<string, RecognitionExample[]>();
  for (const e of dataset.examples) {
    if (e.split !== 'train' || e.signer !== signer || !e.label || !usableCapture(e)) continue;
    const key = personalVariantKey(e.label, e.variantId ?? `session:${e.session}`);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()].flatMap((examples) => {
    if (examples[0].variantId) return examples.length >= 3 ? [{ id: personalVariantKey(examples[0].label!, examples[0].variantId),
      label: examples[0].label!, examples: examples.slice(-3) }] : [];
    const result: PersonalVariant[] = [];
    for (let i = 0; i + 2 < examples.length; i += 3) result.push({ id: personalVariantKey(examples[i].label!, `legacy:${examples[i].id}`),
      label: examples[i].label!, examples: examples.slice(i, i + 3) });
    return result;
  });
}
const averageNearestTwo = (distances: number[]) => {
  distances.sort((a, b) => a - b);
  return distances.length >= 2 ? (distances[0] + distances[1]) / 2 : Infinity;
};

/** User labels are the ground truth for personal gesture associations. Model
 * predictions and other words never veto saving a version. Training examples
 * set a bounded matching radius; held-out tests never influence it. Overlapping
 * meanings remain review choices, never automatic transcript changes.
 */
export async function trainPersonalRanker(dataset: ExampleDataset, signer: string, yieldWork: () => Promise<void> = async () => {}): Promise<PersonalRanker> {
  if (!validDataset(dataset)) throw new Error('Invalid or incompatible landmark dataset.');
  const variants = personalVariants(dataset, signer);
  if (!variants.length) throw new Error('Record three training examples of one gesture version first.');
  if (variants.length > MAX_TRAINING_EXAMPLES / 3) throw new Error('Personal learning supports eight gesture versions. Remove a saved version before adding another.');
  const labels = [...new Set(variants.map((v) => v.label))];
  const examples = variants.flatMap((variant) => variant.examples);
  const calibration: ClassCalibration[] = [];
  for (const variant of variants) {
    const distances = variant.examples.map(() => variant.examples.map(() => Infinity));
    for (let i = 0; i < variant.examples.length; i++) for (let j = i + 1; j < variant.examples.length; j++) {
      distances[i][j] = distances[j][i] = richSequenceDistance(variant.examples[i].sequence, variant.examples[j].sequence);
    }
    const within = distances.map((row, i) => averageNearestTwo(row.filter((_, j) => j !== i)));
    // The caps are conservative engineering bounds, not probability estimates.
    const cap = labels.length === 1 ? 0.12 : 0.22;
    calibration.push({ variant: variant.id, label: variant.label, maxDistance: Math.min(cap, Math.max(0.015, Math.max(...within) * 1.15)) });
    await yieldWork();
  }
  return { examples, variants, calibration, signer };
}

export function refineCandidates(capture: RecognitionCapture, ranker: PersonalRanker | null): string[] {
  const baseline = capture.baseline;
  if (!ranker || !usableCapture(capture) || !validCandidates(baseline)) return baseline;
  const ranked = ranker.variants.map((v) => ({ id: v.id, label: v.label,
    distance: averageNearestTwo(v.examples.map((e) => richSequenceDistance(capture.sequence, e.sequence))) }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  const matches = ranked.filter((v) => {
    const calibration = ranker.calibration.find((c) => c.variant === v.id);
    return calibration && v.distance <= calibration.maxDistance;
  }).map((v) => v.label);
  return [...new Set([...matches, ...baseline])].slice(0, 3);
}

export type BenchmarkReport = {
  known: number; unknown: number; baselineTop1: number | null; baselineTop3: number | null; personalTop1: number | null; personalTop3: number | null;
  changed: number; improved: number; regressed: number; unknownPromotions: number; unseenSigner: number;
  confusions: { expected: string; predicted: string; count: number }[];
  perWord: { label: string; count: number; baselineCorrect: number; personalCorrect: number }[];
};
export async function evaluateExamples(dataset: ExampleDataset, ranker: PersonalRanker | null, yieldWork: () => Promise<void> = async () => {}): Promise<BenchmarkReport> {
  if (!validDataset(dataset)) throw new Error('Invalid or incompatible landmark dataset.');
  const training = dataset.examples.filter((e) => e.split === 'train'); const test = dataset.examples.filter((e) => e.split === 'test');
  if (!test.length) throw new Error('Record test examples in a separate session first.');
  if (test.some((e) => e.baselineVersion !== BASELINE_VERSION)) throw new Error('Suggestion ranking changed. Record fresh test examples; your older training examples are kept.');
  const trainingSessions = new Set(training.map((e) => e.session));
  const trainingSequences = new Set(training.map((e) => JSON.stringify(e.sequence)));
  if (test.some((e) => trainingSessions.has(e.session) || trainingSequences.has(JSON.stringify(e.sequence)))) {
    throw new Error('Training and test captures overlap. Start a new test session and record fresh signs.');
  }
  const known = test.filter((e) => e.label !== null).length;
  const report: BenchmarkReport = { known, unknown: test.length - known, baselineTop1: null, baselineTop3: null, personalTop1: null, personalTop3: null,
    changed: 0, improved: 0, regressed: 0, unknownPromotions: 0, unseenSigner: test.filter((e) => !training.some((t) => t.signer === e.signer)).length, confusions: [], perWord: [] };
  let base1 = 0; let base3 = 0; let personal1 = 0; let personal3 = 0;
  for (const example of test) {
    const choices = refineCandidates(example, ranker); const changed = choices[0] !== example.baseline[0];
    if (changed) report.changed++;
    if (example.label === null) { if (changed) report.unknownPromotions++; }
    else {
      const baselineCorrect = example.baseline[0] === example.label; const personalCorrect = choices[0] === example.label;
      base1 += Number(baselineCorrect); base3 += Number(example.baseline.includes(example.label));
      personal1 += Number(personalCorrect); personal3 += Number(choices.includes(example.label));
      if (!baselineCorrect && personalCorrect) report.improved++;
      if (baselineCorrect && !personalCorrect) report.regressed++;
      let word = report.perWord.find((w) => w.label === example.label);
      if (!word) { word = { label: example.label, count: 0, baselineCorrect: 0, personalCorrect: 0 }; report.perWord.push(word); }
      word.count++; word.baselineCorrect += Number(baselineCorrect); word.personalCorrect += Number(personalCorrect);
      if (!personalCorrect) {
        let confusion = report.confusions.find((c) => c.expected === example.label && c.predicted === choices[0]);
        if (!confusion) { confusion = { expected: example.label, predicted: choices[0], count: 0 }; report.confusions.push(confusion); }
        confusion.count++;
      }
    }
    await yieldWork();
  }
  if (known) { report.baselineTop1 = base1 / known; report.baselineTop3 = base3 / known; report.personalTop1 = personal1 / known; report.personalTop3 = personal3 / known; }
  report.confusions.sort((a, b) => b.count - a.count);
  return report;
}
