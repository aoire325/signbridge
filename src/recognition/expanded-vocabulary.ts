import citizenLabels from '../../assets/models/asl_citizen_labels.json';
import wlaslLabels from '../../assets/models/asl_2000_labels.json';
import wordLabels from '../../assets/models/asl_common_500_labels.json';
import type { WordPrediction } from './asl-word-recognition';

export const CITIZEN_LABELS: readonly string[] = citizenLabels;
export const WLASL_LABELS: readonly string[] = wlaslLabels;
export const wordKey = (label: string) => label.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const citizenWord = (label: string) => wordKey(label.replace(/\d+$/, ''));
const citizenKeys = new Set(CITIZEN_LABELS.map(citizenWord));
const wlaslKeys = new Set(WLASL_LABELS.map(wordKey));
const display = new Map<string, string>();
for (const label of CITIZEN_LABELS) display.set(citizenWord(label), label.replace(/\d+$/, ''));
for (const label of WLASL_LABELS) display.set(wordKey(label), label.toUpperCase());
export const SUPPORTED_WORD_LABELS: readonly string[] = [...display.values()].sort();
// One public word vocabulary. Keep the trained class arrays intact: changing
// their order or truncating model outputs would corrupt the class mapping.
// Strict ASL-LEX frequency-ranked subset; provenance and selection policy are in
// asl_common_500_manifest.json. Do not truncate either trained model's outputs.
export const RECOGNITION_WORD_LABELS: readonly string[] = wordLabels.map((word) => word.toUpperCase());
const recognitionKeys = new Set(RECOGNITION_WORD_LABELS.map(wordKey));
const recognitionDisplay = new Map(RECOGNITION_WORD_LABELS.map((word) => [wordKey(word), word]));

/** Equal probability averaging of two views of the SAME trained model.
 * Returning log probabilities preserves the existing variant pooling/ranking.
 * Never pick whichever pass happens to have the highest softmax confidence.
 */
export function combineCitizenViews(original: Float32Array, mirrored: Float32Array): Float32Array {
  const probability = (logits: Float32Array) => {
    if (logits.length !== CITIZEN_LABELS.length || !logits.every(Number.isFinite)) {
      throw new Error('The word model returned invalid class scores.');
    }
    const max = Math.max(...logits);
    const scores = Array.from(logits, (value) => Math.exp(value - max));
    const total = scores.reduce((sum, score) => sum + score, 0);
    return scores.map((score) => score / total);
  };
  const a = probability(original); const b = probability(mirrored);
  return Float32Array.from(a, (score, i) => Math.log(Math.max(Number.MIN_VALUE, (score + b[i]) / 2)));
}

type RankedWord = { key: string; confidence: number; margin: number };
function ranking(logits: Float32Array, labels: readonly string[], key: (label: string) => string): RankedWord[] {
  if (logits.length !== labels.length || !logits.every(Number.isFinite)) throw new Error('The word model returned invalid class scores.');
  const max = Math.max(...logits);
  const scores = new Map<string, number>();
  let total = 0;
  logits.forEach((value, i) => {
    const score = Math.exp(value - max); total += score;
    const word = key(labels[i]); scores.set(word, (scores.get(word) ?? 0) + score);
  });
  // Different variants of one word compete as one lexical entry, not false
  // alternatives. Probabilities from DIFFERENT models are never added together.
  const ordered = [...scores].sort((a, b) => b[1] - a[1]);
  return ordered.map(([key, score], i) => ({ key, confidence: score / total,
    margin: (score - (ordered[i + 1]?.[1] ?? 0)) / total }));
}

/** Conservative agreement for shared words; retain trained model-exclusive words.
 * Scores are uncalibrated rejection heuristics, never an accuracy percentage.
 */
export function decodeExpandedWord(citizen: Float32Array, wlasl: Float32Array): WordPrediction | null {
  const a = ranking(citizen, CITIZEN_LABELS, citizenWord)[0];
  const b = ranking(wlasl, WLASL_LABELS, wordKey)[0];
  const strong = (word: RankedWord) => word.confidence >= 0.65 && word.margin >= 0.2;
  let best: RankedWord | null = null;
  if (a.key === b.key) best = strong(a) ? a : strong(b) ? b : null;
  else if (strong(a) && strong(b)) return null;
  else if (strong(a) && !wlaslKeys.has(a.key)) best = a;
  else if (strong(b) && !citizenKeys.has(b.key)) best = b;
  return best ? { label: display.get(best.key)!, confidence: best.confidence, margin: best.margin } : null;
}

/** Three distinct ranked alternatives for review, including weak matches.
 * Average the two anatomical views; variants share one lexical rank. Scores
 * are not accuracy estimates and no alternative is automatically accepted.
 * Historical single-view replay retains its original filtering policy.
 */
export function expandedWordSuggestions(citizen: Float32Array, wlasl: Float32Array, mirrored?: Float32Array): string[] {
  const a = ranking(mirrored ? combineCitizenViews(citizen, mirrored) : citizen, CITIZEN_LABELS, citizenWord);
  const b = ranking(wlasl, WLASL_LABELS, wordKey);
  if (!mirrored) {
    const candidates = [a[0], a[1], citizenKeys.has(b[0].key) ? a[2] : b[0]]
      .filter((word) => word.confidence >= 0.05);
    return [...new Set(candidates.map((word) => display.get(word.key)!))].slice(0, 3);
  }
  // Preserve access to model-exclusive vocabulary only for a strong proposal;
  // confidence from these separately trained models is not directly comparable.
  const exclusive = !citizenKeys.has(b[0].key) && b[0].confidence >= 0.65 && b[0].margin >= 0.2;
  const candidates = exclusive ? [a[0], a[1], b[0]] : a.slice(0, 3);
  return candidates.map((word) => display.get(word.key)!);
}

/** Restricted, review-only output using the existing two-view recognition.
 * Keep the full model scores, then rank the permitted words without a confidence
 * cutoff. Every valid inference returns three possibilities, even for flat scores
 * or an excluded leading class. These guesses always require user selection.
 */
export function limitedWordSuggestions(citizen: Float32Array, wlasl: Float32Array, mirrored: Float32Array): string[] {
  const a = ranking(combineCitizenViews(citizen, mirrored), CITIZEN_LABELS, citizenWord);
  const b = ranking(wlasl, WLASL_LABELS, wordKey);
  const eligible = a.filter((word) => recognitionKeys.has(word.key));
  const secondary = b.find((word) => recognitionKeys.has(word.key))!;
  // Give a strong full-vocabulary secondary leader a review slot even when
  // Citizen also knows that word. Never compare or add the two models' scores.
  // Evaluate strength BEFORE filtering: excluded mass must not become certainty.
  const strongSecondary = recognitionKeys.has(b[0].key) && b[0].confidence >= 0.65 && b[0].margin >= 0.2 ? b[0] : null;
  const proposal = strongSecondary ?? (!citizenKeys.has(secondary.key) ? secondary : null);
  const candidates = proposal ? [...eligible.slice(0, 2), proposal, ...eligible] : eligible;
  return [...new Set(candidates.map((word) => recognitionDisplay.get(word.key)!))].slice(0, 3);
}

/** Capture-only diagnostics. These are model leaders, not verified matches. */
export function wordModelLeaders(citizen: Float32Array, mirrored: Float32Array, wlasl: Float32Array) {
  const leaders = (scores: Float32Array, labels: readonly string[], key: (word: string) => string) =>
    ranking(scores, labels, key).slice(0, 3).map((word) => display.get(word.key)!);
  return { primary: leaders(citizen, CITIZEN_LABELS, citizenWord), mirrored: leaders(mirrored, CITIZEN_LABELS, citizenWord),
    secondary: leaders(wlasl, WLASL_LABELS, wordKey) };
}
