import { useCallback, useEffect, useRef, useState } from 'react';

import { visibleHands, type TrackingFrame } from './landmarks';
import { normalizeSignLabel, PersonalVocabulary, SignSegmenter, type WordMatch } from './sequence-recognizer';

const INITIAL_MESSAGE = 'Teach two examples of a word, then sign it and lower both hands out of view.';

export function useLiveSignRecognizer(active: boolean, sessionToken: number) {
  const vocabulary = useRef(new PersonalVocabulary());
  const segmenter = useRef(new SignSegmenter());
  const alive = useRef(false);
  const training = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [frame, setFrame] = useState<TrackingFrame | null>(null);
  const [words, setWords] = useState<PersonalVocabulary['words']>([]);
  const [displaySession, setDisplaySession] = useState(-1);
  const [trainingLabel, setTrainingLabel] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<WordMatch | null>(null);
  const [message, setMessage] = useState(INITIAL_MESSAGE);

  const cancelTraining = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    training.current = null;
    setTrainingLabel(null);
    segmenter.current.reset();
  }, []);

  useEffect(() => {
    alive.current = active;
    const currentSegmenter = segmenter.current;
    currentSegmenter.reset();
    training.current = null;
    if (timer.current) clearTimeout(timer.current);
    return () => {
      alive.current = false;
      training.current = null;
      currentSegmenter.reset();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, sessionToken]);

  const onFrame = useCallback((next: TrackingFrame) => {
    if (!alive.current) return;
    setDisplaySession(sessionToken);
    setFrame(next);
    const result = segmenter.current.accept(next);
    if (result.kind === 'tracking') {
      setCandidate(null);
      setMessage(training.current ? `Learning ${training.current}… Lower both hands out of view when finished.`
        : `${visibleHands(next).length} hands tracked · sign, then lower both hands out of view.`);
    } else if (result.kind === 'interrupted') {
      setCandidate(null);
      setMessage('Keep your face, shoulders and hands visible. Interrupted motion was discarded.');
    } else if (result.kind === 'too-long') {
      setCandidate(null);
      setMessage('Use one sign lasting 0.5–4 seconds. Lower both hands out of view, then try again.');
    } else if (result.kind === 'complete') {
      if (training.current) {
        const label = training.current;
        try {
          vocabulary.current.add(label, result.frames);
          setWords(vocabulary.current.words);
          const count = vocabulary.current.words.find((w) => w.label === label)?.count ?? 0;
          setMessage(`${label}: ${count} example${count === 1 ? '' : 's'} learned. ${count < 2 ? 'Teach it once more to enable matching.' : 'Ready to try. Matches need your confirmation.'}`);
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not learn that example.'); }
        cancelTraining();
      } else {
        const match = vocabulary.current.match(result.frames);
        setCandidate(match);
        setMessage(match ? `Possible match: ${match.label}. Confirm it to add the word.`
          : 'No clear match in your personal vocabulary. Teach more examples or try again.');
      }
    }
  }, [cancelTraining, sessionToken]);

  const teach = useCallback((value: string) => {
    const label = normalizeSignLabel(value);
    if (!active || !alive.current) { setMessage('Start the camera before teaching a word.'); return; }
    if (!label) { setMessage('Enter a word label of 1–40 letters, spaces, apostrophes or hyphens.'); return; }
    cancelTraining();
    setDisplaySession(sessionToken);
    setCandidate(null);
    training.current = label;
    setTrainingLabel(label);
    setMessage(`Sign ${label}, then lower both hands out of view. Only landmarks are held in memory.`);
    timer.current = setTimeout(() => {
      cancelTraining();
      setMessage('Teaching timed out. Try again with your face, shoulders and hands visible.');
    }, 10000);
  }, [active, cancelTraining, sessionToken]);

  const clearVocabulary = useCallback(() => {
    cancelTraining();
    vocabulary.current.clear();
    setWords([]);
    setCandidate(null);
    setMessage(INITIAL_MESSAGE);
  }, [cancelTraining]);

  const dismissCandidate = useCallback(() => setCandidate(null), []);
  const isCurrent = active && displaySession === sessionToken;
  return { frame: isCurrent ? frame : null, words, candidate: isCurrent ? candidate : null,
    trainingLabel: isCurrent ? trainingLabel : null, message: isCurrent ? message : INITIAL_MESSAGE,
    onFrame, teach, cancelTraining, clearVocabulary, dismissCandidate };
} 

