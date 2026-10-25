import { visibleHands, type TrackingFrame } from './landmarks';
import type { WordSample, WordSegment } from './asl-word-recognition';
import { VisibleRestDetector } from './sign-activity';

// These models were trained on whole isolated-sign clips, including the body
// before/after the hands appear. Removing those frames changes normalization
// and the temporal positions learned by the classifier.
const LEAD_IN_MS = 600;
const HANDS_OUT_MS = 550;
const MAX_SIGN_MS = 5000;
export const MAX_CONTEXT_CLIP_MS = 6500;
const MAX_SAMPLES = 200;

export class ContextWordSegmenter {
  private samples: WordSample[] = [];
  private leadIn: WordSample[] = [];
  private firstHand = -1;
  private lastHand = -1;
  private handSamples = 0;
  private lastTimestamp = -1;
  private lastContext = -1;
  private missingSince: number | null = null;
  private latched = false;
  private rest = new VisibleRestDetector();

  constructor(private readonly pack: (frame: TrackingFrame) => Float32Array,
    private readonly hasContext: (frame: TrackingFrame) => boolean) {}

  reset() {
    this.samples = []; this.leadIn = [];
    this.firstHand = -1; this.lastHand = -1; this.handSamples = 0;
    this.lastTimestamp = -1; this.lastContext = -1;
    this.missingSince = null; this.latched = false;
    this.rest.reset();
  }

  finish(): WordSegment {
    const samples = this.samples;
    const valid = this.handSamples >= 4 && this.lastHand - this.firstHand >= 450;
    const hadHands = this.firstHand >= 0;
    this.samples = []; this.leadIn = [];
    this.firstHand = -1; this.lastHand = -1; this.handSamples = 0;
    this.missingSince = null; this.latched = true;
    if (!hadHands) return { kind: 'idle' };
    return valid ? { kind: 'complete', samples } : { kind: 'too-short' };
  }

  accept(frame: TrackingFrame): WordSegment {
    const now = frame.timestampMs;
    if (!Number.isFinite(now) || now <= this.lastTimestamp
      || (this.lastTimestamp >= 0 && now - this.lastTimestamp > 800)) {
      this.reset();
      if (Number.isFinite(now)) this.lastTimestamp = now;
      // A resumed fragment must not become a new word by itself.
      this.latched = true;
      return { kind: 'interrupted' };
    }
    this.lastTimestamp = now;
    const hands = visibleHands(frame).length > 0;
    const resting = this.rest.accept(frame);
    const signing = hands && !resting;
    const context = this.hasContext(frame);
    if (context) this.lastContext = now;
    if (signing) this.missingSince = null;
    else this.missingSince ??= now;

    if (this.latched) {
      if (!signing && now - this.missingSince! >= HANDS_OUT_MS) this.latched = false;
      else return { kind: 'idle' };
    }
    // Do not silently bridge lost framing into a plausible complete sign.
    if (!context) {
      this.leadIn = [];
      if (this.samples.length && now - this.lastContext > 400) {
        this.finish();
        return { kind: 'interrupted' };
      }
      return { kind: 'face-missing' };
    }
    const sample = { timestampMs: now, landmarks: this.pack(frame) };
    if (!this.samples.length && !signing) {
      this.leadIn = [...this.leadIn, sample].filter((s) => now - s.timestampMs <= LEAD_IN_MS).slice(-24);
      return { kind: 'idle' };
    }
    if (!this.samples.length) {
      this.samples = this.leadIn.filter((s) => now - s.timestampMs <= LEAD_IN_MS);
      this.leadIn = [];
      this.firstHand = now;
    }
    if (this.samples.length >= MAX_SAMPLES || (signing && now - this.firstHand > MAX_SIGN_MS)
      || (this.samples.length && now - this.samples[0].timestampMs > MAX_CONTEXT_CLIP_MS)) {
      this.finish();
      return { kind: 'too-long' };
    }
    this.samples.push(sample);
    if (signing) { this.lastHand = now; this.handSamples++; }
    else if (now - this.missingSince! >= HANDS_OUT_MS) {
      const result = this.finish();
      this.latched = false;
      // The boundary can also be the start of the next clip's lead-in.
      this.leadIn = [sample];
      return result;
    }
    return { kind: hands ? 'tracking' : 'idle' };
  }
} 

