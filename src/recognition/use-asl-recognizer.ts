import { useCallback, useRef, useState } from 'react';
import type { PictureRef } from 'expo-camera';
import { useTensorflowModel } from 'react-native-fast-tflite';
import modelAsset from '../../assets/models/asl_alphabet_int8.tflite';

import { ASL_MODEL_LABELS, DYNAMIC_ASL_LETTERS } from '@/recognition/asl-vocabulary';
import { FingerspellingDecoder } from '@/recognition/fingerspelling-decoder';
import {
  createAslModelInput,
  decodeQuantizedProbabilities,
  mirrorModelInput,
} from '@/recognition/image-input';

export type RecognitionFeedback = {
  label: string | null;
  confidence: number;
  message: string;
};

type RuntimeStatus = 'loading' | 'ready' | 'error';

const INITIAL_FEEDBACK: RecognitionFeedback = {
  label: null,
  confidence: 0,
  message: 'Show one hand inside the center square.',
};

function bestTwo(scores: readonly number[]) {
  let first = 0;
  let second = 1;
  if (scores[second]! > scores[first]!) [first, second] = [second, first];
  for (let index = 2; index < scores.length; index += 1) {
    if (scores[index]! > scores[first]!) {
      second = first;
      first = index;
    } else if (scores[index]! > scores[second]!) {
      second = index;
    }
  }
  return { first, confidence: scores[first]!, margin: scores[first]! - scores[second]! };
}

/** Average matching predictions across normal and mirrored views; reject close disagreements. */
function chooseOrientationScores(
  normal: readonly number[],
  mirrored: readonly number[],
): readonly number[] | null {
  const normalBest = bestTwo(normal);
  const mirroredBest = bestTwo(mirrored);
  if (normalBest.first === mirroredBest.first) {
    return normal.map((score, index) => (score + mirrored[index]!) / 2);
  }
  if (Math.abs(normalBest.margin - mirroredBest.margin) < 0.06) return null;
  return normalBest.margin > mirroredBest.margin ? normal : mirrored;
}

export function useAslRecognizer(onLetter: (letter: string) => void) {
  const modelState = useTensorflowModel(modelAsset, []);
  const decoder = useRef(new FingerspellingDecoder());
  const [feedback, setFeedback] = useState(INITIAL_FEEDBACK);
  const [frameError, setFrameError] = useState('');

  const status: RuntimeStatus = modelState.state === 'loading'
    ? 'loading'
    : modelState.state === 'error'
      ? 'error'
      : 'ready';
  const error = modelState.state === 'error' ? modelState.error.message : frameError;

  const recognizePicture = useCallback(async (picture: PictureRef) => {
    if (modelState.state !== 'loaded') return;

    try {
      setFrameError('');
      const input = await createAslModelInput(picture);
      const normalOutputs = await modelState.model.run([input]);
      const mirroredOutputs = await modelState.model.run([mirrorModelInput(input)]);
      const normalOutput = normalOutputs[0];
      const mirroredOutput = mirroredOutputs[0];
      if (!normalOutput || !mirroredOutput) throw new Error('The ASL model returned no class scores.');

      const normalProbabilities = decodeQuantizedProbabilities(normalOutput);
      const mirroredProbabilities = decodeQuantizedProbabilities(mirroredOutput);
      if (normalProbabilities.length !== ASL_MODEL_LABELS.length
        || mirroredProbabilities.length !== ASL_MODEL_LABELS.length) {
        throw new Error('The ASL model vocabulary does not match its output classes.');
      }

      const probabilities = chooseOrientationScores(normalProbabilities, mirroredProbabilities);
      if (!probabilities) {
        decoder.current.reject();
        setFeedback({
          label: null,
          confidence: 0,
          message: 'Unclear hand orientation. Turn your palm toward the camera and hold still.',
        });
        return;
      }

      const { first: bestIndex, confidence } = bestTwo(probabilities);
      const label = ASL_MODEL_LABELS[bestIndex]!;
      const result = decoder.current.accept({ label, confidence, timestampMs: Date.now() });
      if (result.kind === 'letter' && result.label) onLetter(result.label);

      const percent = Math.round(confidence * 100);
      let message = 'Move your hand closer and hold the letter steady.';
      if (result.kind === 'candidate') message = `Reading ${label} · hold steady (${percent}%).`;
      if (result.kind === 'held') message = `${label} added · relax your hand before repeating it.`;
      if (result.kind === 'letter') message = `Added ${label} to the transcript (${percent}%).`;
      if (result.kind === 'neutral') message = 'Hand relaxed · ready for the next letter.';
      if (result.kind === 'motion-required') {
        message = `${label} needs a motion model, so it was not added.`;
      }
      setFeedback({ label: result.label, confidence, message });
    } catch (recognitionError) {
      decoder.current.reject();
      const message =
        recognitionError instanceof Error
          ? recognitionError.message
          : 'The camera frame could not be classified.';
      setFrameError(message);
      setFeedback({ label: null, confidence: 0, message: 'Frame skipped. Retrying recognition…' });
    }
  }, [modelState, onLetter]);

  const reset = useCallback(() => {
    decoder.current.reset();
    setFeedback(INITIAL_FEEDBACK);
  }, []);

  return {
    status,
    error,
    feedback,
    recognizePicture,
    reset,
    unsupportedMotionLetters: DYNAMIC_ASL_LETTERS,
  };
} 

