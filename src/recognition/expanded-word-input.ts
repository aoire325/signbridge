import { packExpandedLandmarks, createExpandedModelInput } from './asl1000-recognition';
import { CITIZEN_FEATURES, packCitizenLandmarks, createCitizenModelInput, mirrorCitizenSamples } from './citizen-recognition';
import type { TrackingFrame } from './landmarks';
import type { WordSample } from './asl-word-recognition';

export const hasExpandedContext = (frame: TrackingFrame) => frame.width > 0 && frame.height > 0 && [11, 12].every((i) => !!frame.pose[i]
  && Number.isFinite(frame.pose[i].x) && Number.isFinite(frame.pose[i].y) && (frame.pose[i].visibility ?? 1) >= 0.5);

export function packExpandedWordLandmarks(frame: TrackingFrame) {
  const combined = new Float32Array(CITIZEN_FEATURES + 110);
  combined.set(packCitizenLandmarks(frame));
  combined.set(packExpandedLandmarks(frame), CITIZEN_FEATURES);
  return combined;
}

export function createExpandedWordInputs(samples: readonly WordSample[]) {
  if (samples.some((s) => s.landmarks.length !== CITIZEN_FEATURES + 110)) throw new Error('Invalid expanded word capture.');
  const citizenSamples = samples.map((s) => ({ ...s, landmarks: s.landmarks.slice(0, CITIZEN_FEATURES) }));
  return {
    citizen: createCitizenModelInput(citizenSamples),
    citizenMirrored: createCitizenModelInput(mirrorCitizenSamples(citizenSamples)),
    wlasl: createExpandedModelInput(samples.map((s) => ({ ...s, landmarks: s.landmarks.slice(CITIZEN_FEATURES) }))),
  };
} 

