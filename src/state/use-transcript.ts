import { useCallback, useReducer } from 'react';

import { countWords, initialTranscriptState, transcriptReducer } from '@/state/transcript-state';

export function useTranscript() {
  const [state, dispatch] = useReducer(transcriptReducer, initialTranscriptState);
  const beginEditing = useCallback(() => dispatch({ type: 'begin-editing' }), []);
  const update = useCallback((value: string) => dispatch({ type: 'change', value }), []);
  const appendLetter = useCallback((value: string) => dispatch({ type: 'append-letter', value }), []);
  const appendWord = useCallback((value: string) => dispatch({ type: 'append-word', value }), []);
  const appendSpace = useCallback(() => dispatch({ type: 'append-space' }), []);
  const backspace = useCallback(() => dispatch({ type: 'backspace' }), []);
  const commitEditing = useCallback(() => dispatch({ type: 'commit-editing' }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  return {
    value: state.value,
    isEditing: state.editingStart !== null,
    wordCount: countWords(state.value),
    canUndo: state.undoStack.length > 0,
    beginEditing,
    update,
    appendLetter,
    appendWord,
    appendSpace,
    backspace,
    commitEditing,
    undo,
    clear,
  };
} 

