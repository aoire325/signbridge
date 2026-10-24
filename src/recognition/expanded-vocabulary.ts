import citizenLabels from '../../assets/models/asl_citizen_labels.json';
import wlaslLabels from '../../assets/models/asl_2000_labels.json';
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

/** Unconfirmed alternatives never enter the transcript until the user chooses.
 * Prefer the MediaPipe-trained model for its own vocabulary. The OpenPose
 * adapter only supplies an additional model-exclusive word; its unrelated
 * shared-word guesses must not displace a better matched model's alternatives.
 * With a second view, Citizen candidates must appear in both top-three lists;
 * exclusive WLASL proposals need the existing strong-score rejection heuristic.
 * Omit the second view only when reproducing the historical single-pass check.
 */
export function expandedWordSuggestions(citizen: Float32Array, wlasl: Float32Array, mirrored?: Float32Array): string[] {
  const a = ranking(mirrored ? combineCitizenViews(citizen, mirrored) : citizen, CITIZEN_LABELS, citizenWord);
  const b = ranking(wlasl, WLASL_LABELS, wordKey);
  const mirrorKeys = mirrored ? new Set(ranking(mirrored, CITIZEN_LABELS, citizenWord).slice(0, 3).map((r) => r.key)) : null;
  const stable = mirrorKeys ? new Set(ranking(citizen, CITIZEN_LABELS, citizenWord).slice(0, 3).map((r) => r.key)
    .filter((key) => mirrorKeys.has(key))) : null;
  const candidates = [a[0], a[1], citizenKeys.has(b[0].key) ? a[2] : b[0]]
    .filter((word) => word.confidence >= 0.05 && (!stable || (citizenKeys.has(word.key)
      ? stable.has(word.key) : word.confidence >= 0.65 && word.margin >= 0.2)));
  return [...new Set(candidates.map((word) => display.get(word.key)!))].slice(0, 3);
} 

