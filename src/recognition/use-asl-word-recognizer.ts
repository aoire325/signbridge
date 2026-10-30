import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useBundledModel } from './local-model';
import citizenModelAsset from '../../assets/models/asl_words_citizen.tflite';
import expandedModelAsset from '../../assets/models/asl_words_2000.tflite';
import { limitedWordSuggestions, wordModelLeaders } from './expanded-vocabulary';
import { createExpandedWordInputs, packExpandedWordLandmarks, hasExpandedContext } from './expanded-word-input';

import { visibleHands, type TrackingFrame } from './landmarks';
import type { WordSegment } from './asl-word-recognition';
import { ContextWordSegmenter } from './context-word-segmenter';
import { buildSignSequence, signFeatureFrame, type FeatureFrame } from './sign-features';
import { refineCandidates, type PersonalRanker, type RecognitionCapture } from './recognition-examples';

export type RecognitionLearning = {
  captureToken: string | null;
  ranker: PersonalRanker | null;
  onCapture: (token: string, capture: RecognitionCapture) => void;
};

const INITIAL_MESSAGE = 'Start with your hands lowered. Keep your shoulders visible, sign one word, then lower your hands and wait for the result.';

export function useAslWordRecognizer(active: boolean, sessionToken: number, onWord: (word: string) => void, learning?: RecognitionLearning, loadModels = true) {
  const activation = useMemo(() => ({ active, sessionToken }), [active, sessionToken]);
  const modelState = useBundledModel(citizenModelAsset, loadModels);
  const secondaryState = useBundledModel(expandedModelAsset, loadModels);
  const segmenter = useRef(new ContextWordSegmenter(packExpandedWordLandmarks, hasExpandedContext));
  const lifecycle = useRef({ active: false, generation: 0 });
  const busy = useRef(false);
  const lastDisplayTimestamp = useRef(-Infinity);
  const [frame, setFrame] = useState<TrackingFrame | null>(null);
  const [displaySession, setDisplaySession] = useState(-1);
  const [message, setMessage] = useState(INITIAL_MESSAGE);
  const [processing, setProcessing] = useState(false);
  const [suggestions, setSuggestions] = useState<{ generation: number; labels: string[]; activation: object | null }>({ generation: -1, labels: [], activation: null });
  const confirmedSuggestions = useRef<object | null>(null);
  const featureBuffer = useRef<{ feature: FeatureFrame; hands: boolean; face: boolean }[]>([]);
  const learningRef = useRef(learning);
  useLayoutEffect(() => { learningRef.current = learning; });
  useLayoutEffect(() => {
    // Arming starts a fresh clip; it cannot label an earlier camera capture.
    featureBuffer.current = [];
    if (learning?.captureToken) segmenter.current.reset();
  }, [learning?.captureToken]);

  useLayoutEffect(() => {
    lifecycle.current = { active, generation: lifecycle.current.generation + 1 };
    lastDisplayTimestamp.current = -Infinity;
    featureBuffer.current = [];
    const currentSegmenter = new ContextWordSegmenter(packExpandedWordLandmarks, hasExpandedContext);
    segmenter.current = currentSegmenter;
    currentSegmenter.reset();
    return () => {
      lifecycle.current.active = false;
      lifecycle.current.generation++;
      currentSegmenter.reset();
      featureBuffer.current = [];
    };
  }, [active, sessionToken]);

  const recognize = useCallback(async (result: WordSegment) => {
    if (result.kind !== 'complete' || !lifecycle.current.active) return;
    if (busy.current) return;
    const generation = lifecycle.current.generation;
    const current = () => lifecycle.current.active && lifecycle.current.generation === generation;
    const captureToken = learningRef.current?.captureToken;
    const personalRanker = learningRef.current?.ranker;
    const observations = featureBuffer.current.filter(({ feature }) => feature.timestampMs >= result.samples[0].timestampMs
      && feature.timestampMs <= result.samples.at(-1)!.timestampMs);
    // A profile enabled halfway through a sign must not classify its fragment
    // as though it were a complete teaching example.
    const fullFeatureClip = observations[0]?.feature.timestampMs === result.samples[0].timestampMs
      && observations.at(-1)?.feature.timestampMs === result.samples.at(-1)!.timestampMs;
    const sequence = fullFeatureClip ? buildSignSequence(observations.map((o) => o.feature)) : null;
    featureBuffer.current = [];
    const started = Date.now();
    const makeCapture = (baseline: string[], evidence?: RecognitionCapture['evidence']): RecognitionCapture | null => sequence ? {
      sequence, baseline, displayed: baseline, ...(evidence ? { evidence } : {}), diagnostics: {
        frames: observations.length, fps: (observations.length - 1) * 1000 / sequence.durationMs,
        maxGapMs: Math.max(...observations.slice(1).map((o, i) => o.feature.timestampMs - observations[i].feature.timestampMs)),
        handCoverage: observations.filter((o) => o.hands).length / observations.length,
        faceCoverage: observations.filter((o) => o.face).length / observations.length, inferenceMs: Date.now() - started,
      },
    } : null;
    const deliverCapture = (capture: RecognitionCapture | null) => {
      if (capture && current() && captureToken && learningRef.current?.captureToken === captureToken) learningRef.current.onCapture(captureToken, capture);
    };
    // Teaching depends on tracked motion and the user's label, never on a model
    // agreeing or even returning predictions. Empty predictions stay explicit.
    if (modelState.state !== 'loaded' || secondaryState.state !== 'loaded') {
      deliverCapture(makeCapture([]));
      setMessage(modelState.state === 'error' ? modelState.error.message : secondaryState.state === 'error'
        ? secondaryState.error.message : 'Word models are preparing. Personal gesture recording is still available.');
      segmenter.current.reset(); segmenter.current.finish();
      return;
    }
    busy.current = true;
    setSuggestions({ generation: -1, labels: [], activation: null });
    setProcessing(true);
    setMessage('Reading your sign…');
    try {
      const inputTensor = modelState.model.inputs[0];
      if (inputTensor?.dataType !== 'float32' || inputTensor.shape.join(',') !== '1,2,128,27') {
        throw new Error('The word model input does not match the landmark format.');
      }
      const expandedInputs = createExpandedWordInputs(result.samples);
      const input = expandedInputs.citizen;
      const outputs = await modelState.model.run([input.buffer as ArrayBuffer]);
      if (!current()) return;
      if (!outputs[0]) throw new Error('The word model returned no result.');
      // fast-tflite reuses its native output buffer on the next run. Preserve
      // pass one before invoking the same interpreter for the mirrored view.
      const firstScores = new Float32Array(outputs[0]).slice();
      setMessage('Double-checking your sign…');
      const mirroredOutputs = await modelState.model.run([expandedInputs.citizenMirrored.buffer as ArrayBuffer]);
      if (!current()) return;
      if (!mirroredOutputs[0]) throw new Error('The second word recognition pass returned no result.');
      if (secondaryState.state !== 'loaded' || secondaryState.model.inputs[0]?.dataType !== 'float32'
        || secondaryState.model.inputs[0].shape.join(',') !== '1,55,100') throw new Error('The word model has an incompatible input.');
      const secondOutputs = await secondaryState.model.run([expandedInputs.wlasl.buffer as ArrayBuffer]);
      if (!current()) return;
      if (!secondOutputs[0]) throw new Error('The word model returned no result.');
      // Keep the existing trained models, but expose only the fixed 500-word
      // vocabulary. Even strong predictions require review, never auto-insert.
      const baseline = limitedWordSuggestions(firstScores, new Float32Array(secondOutputs[0]),
        new Float32Array(mirroredOutputs[0]));
      let labels = baseline;
      const capture = sequence ? makeCapture(baseline, wordModelLeaders(firstScores, new Float32Array(mirroredOutputs[0]), new Float32Array(secondOutputs[0]))) : null;
      if (capture) {
        // Do not apply a profile disabled or replaced while native inference ran.
        labels = refineCandidates(capture, learningRef.current?.ranker === personalRanker ? personalRanker ?? null : null);
        capture.displayed = labels;
        deliverCapture(capture);
      }
      setSuggestions({ generation, labels, activation });
      setMessage('Possible matches — choose one, or sign another word.');
    } catch (error) {
      deliverCapture(makeCapture([]));
      if (current()) setMessage(error instanceof Error ? error.message : 'Could not read this sign. Please try again.');
    } finally {
      if (current()) {
        // Discard movements during inference; the segmenter waits for hands
        // to lower and settle (or leave the frame) before the next sign.
        segmenter.current.reset();
        segmenter.current.finish();
        featureBuffer.current = [];
      }
      busy.current = false;
      // Never leave a stale spinner after a camera switch or paused edit.
      setProcessing(false);
    }
  }, [modelState, secondaryState, activation]);

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
    if (learningRef.current?.captureToken || learningRef.current?.ranker) {
      const feature = signFeatureFrame(next);
      if (feature) featureBuffer.current = [...featureBuffer.current, { feature, hands: visibleHands(next).length > 0, face: next.face.length >= 468 }]
        .filter((o) => next.timestampMs - o.feature.timestampMs <= 6500).slice(-200);
    }
    const result = segmenter.current.accept(next);
    if (result.kind === 'interrupted' || result.kind === 'too-long' || result.kind === 'too-short') featureBuffer.current = [];
    if (result.kind === 'complete') void recognize(result);
    else if (!busy.current) {
      if (result.kind === 'tracking') setMessage('Reading movement · lower both hands when finished and wait for the result, or tap Finish sign.');
      if (result.kind === 'face-missing') setMessage('Move back so your shoulders and signing hands are visible.');
      if (result.kind === 'too-long') setMessage('Use one word lasting 0.5–5 seconds. Lower both hands, then try again.');
      if (result.kind === 'too-short') setMessage('That sign was too brief. Sign for at least half a second, then lower both hands.');
      if (result.kind === 'interrupted') setMessage('Tracking was interrupted. Lower both hands and try the word again.');
    }
  }, [recognize, sessionToken]);

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
    processing,
    candidates: active && suggestions.activation === activation ? suggestions.labels : [],
    chooseCandidate,
    status: modelState.state !== 'loaded' ? modelState.state : secondaryState.state,
    error: modelState.state === 'error' ? modelState.error.message : secondaryState.state === 'error' ? secondaryState.error.message : '',
    onFrame, finishSign,
  };
} 

