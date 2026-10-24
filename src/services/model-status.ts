import { SUPPORTED_WORD_LABELS } from '@/recognition/expanded-vocabulary';

export type ModelStatus = {
  ready: boolean;
  label: string;
  version: string | null;
  supportedSigns: readonly string[];
  message: string;
  trackingBundled: boolean;
  supportsGrammar: boolean;
  sentenceTranslation: 'experimental-offline';
};

/** Bundled isolated-word classification is distinct from continuous ASL translation. */
export const ModelStatusService = {
  getStatus(): ModelStatus {
    return {
      ready: true,
      label: `MediaPipe + ${SUPPORTED_WORD_LABELS.length.toLocaleString()} word entries / 250-sign fallback`,
      version: 'ASL Citizen 17f0148 (2,731 classes) + TGCN-WLASL dacb456 (2,000 classes) / ISLR d831c2f (250)',
      supportedSigns: SUPPORTED_WORD_LABELS,
      trackingBundled: true,
      supportsGrammar: true,
      sentenceTranslation: 'experimental-offline',
      message: `The default ${SUPPORTED_WORD_LABELS.length.toLocaleString()}-entry vocabulary uses two pretrained offline models, keeps the start and ending of each sign, and prioritizes MediaPipe-trained recognition. Expanded predictions require user review: recorded-pose checks improved, but live phone accuracy is unvalidated. Legacy 1,000-sign and 250-sign models remain available. Live sentence accuracy is unvalidated; the separate sentence model produces reviewable drafts.`,
    };
  },
}; 

