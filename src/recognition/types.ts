export type NormalizedLandmarkFrame = {
  timestampMs: number;
  /** Normalized hand/body features produced by the landmark-processing stage. */
  features: Float32Array;
};

export type SignPrediction = {
  label: string;
  confidence: number;
  timestampMs: number;
  modelVersion: string;
};

/** A runtime-independent contract for a trained isolated-sign model. */
export interface SignRecognitionModel {
  readonly version: string;
  initialize(): Promise<void>;
  recognize(sequence: readonly NormalizedLandmarkFrame[]): Promise<SignPrediction | null>;
} 

