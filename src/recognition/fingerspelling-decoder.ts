import { ASL_MODEL_LABELS, DYNAMIC_ASL_LETTERS } from '@/recognition/asl-vocabulary';

export type ClassifierPrediction = {
  label: string;
  confidence: number;
  timestampMs: number;
};

export type DecoderResult = {
  kind: 'neutral' | 'uncertain' | 'candidate' | 'held' | 'letter' | 'motion-required';
  label: string | null;
  confidence: number;
};

const MIN_CONFIDENCE = 0.78;
const VOTE_WINDOW_SIZE = 5;
const MIN_VOTES = 3;
const MIN_STABLE_DURATION_MS = 420;
const MIN_VOTE_CONFIDENCE = 0.55;
// Image preprocessing plus two model passes can take longer than the capture timer
// interval on older devices. Keep a usable vote window across normal slow frames.
const MAX_PREDICTION_GAP_MS = 2500;

/** Converts repeated frame classifications into one fingerspelled character. */
export class FingerspellingDecoder {
  private recent: ClassifierPrediction[] = [];
  private candidate = '';
  private candidateSinceMs = 0;
  private committedLabel = '';

  accept(prediction: ClassifierPrediction): DecoderResult {
    if (!ASL_MODEL_LABELS.includes(prediction.label as (typeof ASL_MODEL_LABELS)[number])) {
      this.clearPending();
      return { kind: 'uncertain', label: null, confidence: prediction.confidence };
    }

    if (prediction.confidence < MIN_VOTE_CONFIDENCE) {
      this.clearPending();
      return { kind: 'uncertain', label: null, confidence: prediction.confidence };
    }

    const lastPrediction = this.recent.at(-1);
    if (lastPrediction && prediction.timestampMs - lastPrediction.timestampMs > MAX_PREDICTION_GAP_MS) {
      this.clearPending();
    }

    this.recent = this.recent.filter((item) => prediction.timestampMs - item.timestampMs <= MAX_PREDICTION_GAP_MS);
    this.recent.push(prediction);
    if (this.recent.length > VOTE_WINDOW_SIZE) this.recent.shift();

    const votes = new Map<string, ClassifierPrediction[]>();
    for (const item of this.recent) {
      const sameLabel = votes.get(item.label) ?? [];
      sameLabel.push(item);
      votes.set(item.label, sameLabel);
    }
    const [label, labelVotes] = [...votes.entries()].sort((left, right) => right[1].length - left[1].length)[0] ?? [];
    if (!label || !labelVotes || labelVotes.length < MIN_VOTES) {
      return prediction.confidence >= MIN_CONFIDENCE
        ? { kind: 'candidate', label: prediction.label, confidence: prediction.confidence }
        : { kind: 'uncertain', label: null, confidence: prediction.confidence };
    }

    const confidence = labelVotes.reduce((total, item) => total + item.confidence, 0) / labelVotes.length;
    const firstVoteAt = labelVotes[0]!.timestampMs;
    if (label === 'nothing' ? confidence < MIN_VOTE_CONFIDENCE : confidence < MIN_CONFIDENCE) {
      this.clearPending();
      return { kind: 'uncertain', label: null, confidence };
    }

    if (label !== this.candidate) {
      this.candidate = label;
      this.candidateSinceMs = firstVoteAt;
    }

    const stable = prediction.timestampMs - this.candidateSinceMs >= MIN_STABLE_DURATION_MS;
    if (!stable) return { kind: 'candidate', label, confidence };

    if (label === 'nothing') {
      this.committedLabel = '';
      return { kind: 'neutral', label: null, confidence };
    }
    if (label === this.committedLabel) return { kind: 'held', label, confidence };

    this.committedLabel = label;
    if (DYNAMIC_ASL_LETTERS.includes(label as (typeof DYNAMIC_ASL_LETTERS)[number])) {
      return { kind: 'motion-required', label, confidence };
    }
    return { kind: 'letter', label, confidence };
  }

  reset(): void {
    this.recent = [];
    this.candidate = '';
    this.candidateSinceMs = 0;
    this.committedLabel = '';
  }

  /** Drop uncertain-frame evidence without releasing the repeated-letter latch. */
  reject(): void {
    this.clearPending();
  }

  private clearPending(): void {
    this.recent = [];
    this.candidate = '';
    this.candidateSinceMs = 0;
  }
} 

