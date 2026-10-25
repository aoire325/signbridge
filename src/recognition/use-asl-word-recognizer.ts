import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useBundledModel } from './local-model';
import basicModelAsset from '../../assets/models/asl_words_250.tflite';
import citizenModelAsset from '../../assets/models/asl_words_citizen.tflite';
import expandedModelAsset from '../../assets/models/asl_words_2000.tflite';
import standardModelAsset from '../../assets/models/asl_words_1000.tflite';
import { EXPANDED_WORD_LABELS, createExpandedModelInput, packExpandedLandmarks } from './asl1000-recognition';
import { expandedWordSuggestions } from './expanded-vocabulary';
import { createExpandedWordInputs, packExpandedWordLandmarks, hasExpandedContext } from './expanded-word-input';

import type { TrackingFrame } from './landmarks';
import { createWordModelInput, decodeWordPrediction, WordSegmenter, WORD_MODEL_LABELS, type WordPrediction, type WordSegment } from './asl-word-recognition';
import { ContextWordSegmenter } from './context-word-segmenter';

const INITIAL_MESSAGE = 'Start with your hands lowered. Keep your shoulders visible, sign one word, then lower your hands and wait for the result.';

export type WordVocabulary = 'basic' | 'standard' | 'expanded';

export function useAslWordRecognizer(active: boolean, sessionToken: number, onWord: (word: string) => void, vocabulary: WordVocabulary = 'expanded') {
  const expanded = vocabulary === 'expanded';
  const standard = vocabulary === 'standard';
  const activation = useMemo(() => ({ active, sessionToken, vocabulary }), [active, sessionToken, vocabulary]);
  const modelState = useBundledModel(expanded ? citizenModelAsset : standard ? standardModelAsset : basicModelAsset);
  const secondaryState = useBundledModel(expandedModelAsset, expanded);
  const segmenter = useRef<WordSegmenter | ContextWordSegmenter>(new WordSegmenter());
  const lifecycle = useRef({ active: false, generation: 0 });
  const busy = useRef(false);
  const lastDisplayTimestamp = useRef(-Infinity);
  const [frame, setFrame] = useState<TrackingFrame | null>(null);
  const [displaySession, setDisplaySession] = useState(-1);
  const [message, setMessage] = useState(INITIAL_MESSAGE);
  const [lastWord, setLastWord] = useState<WordPrediction | null>(null);
  const [processing, setProcessing] = useState(false);
  const [suggestions, setSuggestions] = useState<{ generation: number; labels: string[]; activation: object | null }>({ generation: -1, labels: [], activation: null });
  const confirmedSuggestions = useRef<object | null>(null);

  useLayoutEffect(() => {
    lifecycle.current = { active, generation: lifecycle.current.generation + 1 };
    lastDisplayTimestamp.current = -Infinity;
    const currentSegmenter = expanded ? new ContextWordSegmenter(packExpandedWordLandmarks, hasExpandedContext)
      : standard ? new WordSegmenter(packExpandedLandmarks, hasExpandedContext) : new WordSegmenter();
    segmenter.current = currentSegmenter;
    currentSegmenter.reset();
    return () => {
      lifecycle.current.active = false;
      lifecycle.current.generation++;
      currentSegmenter.reset();
    };
  }, [active, sessionToken, expanded, standard]);

  const recognize = useCallback(async (result: WordSegment) => {
    if (result.kind !== 'complete' || !lifecycle.current.active) return;
    if (modelState.state !== 'loaded' || (expanded && secondaryState.state !== 'loaded')) {
      setMessage(modelState.state === 'error' ? modelState.error.message : expanded && secondaryState.state === 'error'
        ? secondaryState.error.message : 'Word models are preparing. Please try the sign again in a moment.');
      return;
    }
    if (busy.current) return;
    const generation = lifecycle.current.generation;
    const current = () => lifecycle.current.active && lifecycle.current.generation === generation;
    busy.current = true;
    setSuggestions({ generation: -1, labels: [], activation: null });
    setProcessing(true);
    setMessage('Reading your sign…');
    try {
      const inputTensor = modelState.model.inputs[0];
      if (inputTensor?.dataType !== 'float32' || inputTensor.shape.join(',') !== (expanded ? '1,2,128,27' : standard ? '1,55,100' : '32,543,3')) {
        throw new Error('The word model input does not match the landmark format.');
      }
      const expandedInputs = expanded ? createExpandedWordInputs(result.samples) : null;
      const input = expandedInputs ? expandedInputs.citizen : standard ? createExpandedModelInput(result.samples) : createWordModelInput(result.samples);
      const outputs = await modelState.model.run([input.buffer as ArrayBuffer]);
      if (!current()) return;
      if (!outputs[0]) throw new Error('The word model returned no result.');
      // fast-tflite reuses its native output buffer on the next run. Preserve
      // pass one before invoking the same interpreter for the mirrored view.
      const firstScores = new Float32Array(outputs[0]).slice();
      let prediction: WordPrediction | null;
      if (expanded) {
        setMessage('Double-checking your sign…');
        const mirroredOutputs = await modelState.model.run([expandedInputs!.citizenMirrored.buffer as ArrayBuffer]);
        if (!current()) return;
        if (!mirroredOutputs[0]) throw new Error('The second word recognition pass returned no result.');
        if (secondaryState.state !== 'loaded' || secondaryState.model.inputs[0]?.dataType !== 'float32'
          || secondaryState.model.inputs[0].shape.join(',') !== '1,55,100') throw new Error('The expanded word model has an incompatible input.');
        const secondInput = expandedInputs!.wlasl;
        const secondOutputs = await secondaryState.model.run([secondInput.buffer as ArrayBuffer]);
        if (!current()) return;
        if (!secondOutputs[0]) throw new Error('The expanded word model returned no result.');
        // Replay improved, but does not establish live signer accuracy.
        // Predictions remain review-only, including apparent model agreement.
        const labels = expandedWordSuggestions(firstScores, new Float32Array(secondOutputs[0]),
          new Float32Array(mirroredOutputs[0]));
        setSuggestions({ generation, labels, activation });
        setLastWord(null);
        setMessage('Possible matches — choose one, or sign another word.');
        return;
      } else prediction = decodeWordPrediction(firstScores, standard ? EXPANDED_WORD_LABELS : WORD_MODEL_LABELS);
      setLastWord(prediction);
      if (prediction) {
        onWord(prediction.label);
        setMessage(`Added ${prediction.label}. Sign the next word, or use Undo to correct it.`);
      } else {
        setMessage('No clear, consistent word match. Review the possible matches below, repeat the sign, or try the 250-sign model.');
      }
    } catch (error) {
      if (current()) setMessage(error instanceof Error ? error.message : 'Could not read this sign. Please try again.');
    } finally {
      if (current()) {
        // Discard movements during inference; both segmenters wait for hands
        // to leave the frame before starting another isolated sign.
        segmenter.current.reset();
        segmenter.current.finish();
      }
      busy.current = false;
      // Never leave a stale spinner after a camera switch or paused edit.
      setProcessing(false);
    }
  }, [modelState, secondaryState, onWord, expanded, standard, activation]);

  const onFrame = useCallback((next: TrackingFrame) => {
    if (!lifecycle.current.active) return;
    // Consume every native observation, but don't redraw the whole screen at
    // the capture rate. Overlay work must not compete with recognition.
    if (next.timestampMs - lastDisplayTimestamp.current >= 100 || next.timestampMs < lastDisplayTimestamp.current) {
      lastDisplayTimestamp.current = next.timestampMs;
      setDisplaySession(sessionToken); setFrame(next);
    }
    // Keep tracking live; discard movements only while inference is busy.
    if (busy.current) return;
    const result = segmenter.current.accept(next);
    if (result.kind === 'complete') void recognize(result);
    else if (!busy.current) {
      if (result.kind === 'tracking') setMessage('Reading movement · lower both hands when finished and wait for the result, or tap Finish sign.');
      if (result.kind === 'face-missing') setMessage(expanded || standard ? 'Move back so your shoulders and signing hands are visible for the expanded word models.' : 'Keep your face visible too; this word model uses face and hand landmarks together.');
      if (result.kind === 'too-long') setMessage('Use one word lasting 0.5–5 seconds. Lower both hands, then try again.');
      if (result.kind === 'too-short') setMessage('That sign was too brief. Sign for at least half a second, then lower both hands.');
      if (result.kind === 'interrupted') setMessage('Tracking was interrupted. Lower both hands and try the word again.');
    }
  }, [recognize, sessionToken, expanded, standard]);

  const finishSign = useCallback(() => {
    if (!lifecycle.current.active || busy.current) return;
    const result = segmenter.current.finish();
    if (result.kind === 'too-short') setMessage('Sign for at least half a second before finishing. Lower both hands to try again.');
    else if (result.kind === 'idle') setMessage('Lower both hands, then sign a word before finishing.');
    else void recognize(result);
  }, [recognize]);

  const resumeCapture = useCallback(() => {
    segmenter.current.reset();
    segmenter.current.finish();
    setSuggestions({ generation: -1, labels: [], activation: null });
  }, []);

  const chooseCandidate = useCallback((label: string) => {
    if (!lifecycle.current.active || busy.current || confirmedSuggestions.current === suggestions || suggestions.generation !== lifecycle.current.generation
      || !suggestions.labels.includes(label)) return;
    confirmedSuggestions.current = suggestions;
    onWord(label);
    resumeCapture();
    setMessage(`Added ${label} after your review. Lower both hands before signing the next word.`);
  }, [onWord, suggestions, resumeCapture]);

  return {
    frame: active && displaySession === sessionToken ? frame : null,
    message: displaySession === sessionToken ? message : INITIAL_MESSAGE,
    lastWord, processing,
    candidates: active && suggestions.activation === activation ? suggestions.labels : [],
    chooseCandidate,
    status: modelState.state !== 'loaded' ? modelState.state : expanded ? secondaryState.state : 'loaded',
    error: modelState.state === 'error' ? modelState.error.message : expanded && secondaryState.state === 'error' ? secondaryState.error.message : '',
    onFrame, finishSign,
  };
} 

