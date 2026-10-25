import { RECOGNITION_WORD_LABELS } from '@/recognition/expanded-vocabulary';

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
      label: `MediaPipe + ${RECOGNITION_WORD_LABELS.length.toLocaleString()} supported words`,
      version: 'ASL Citizen 17f0148 (2,731 classes) + TGCN-WLASL dacb456 (2,000 classes)',
      supportedSigns: RECOGNITION_WORD_LABELS,
      trackingBundled: true,
      supportsGrammar: true,
      sentenceTranslation: 'experimental-offline',
      message: 'The 500-entry dictionary selects the top 500 strictly by ASL-LEX frequency ratings within the matched pretrained model vocabulary, with no exceptions. This is not a universal frequency ranking. All predictions require review. Personal learning and held-out tests are available in Recognition Lab. Live word accuracy is unvalidated. Live sentence accuracy is unvalidated.',
    };
  },
}; 

