export type TranscriptState = {
  value: string;
  undoStack: readonly string[];
  editingStart: string | null;
};

export type TranscriptAction =
  | { type: 'begin-editing' }
  | { type: 'change'; value: string }
  | { type: 'append-letter'; value: string }
  | { type: 'append-word'; value: string }
  | { type: 'append-space' }
  | { type: 'backspace' }
  | { type: 'commit-editing' }
  | { type: 'undo' }
  | { type: 'clear' };

const MAX_UNDO_STEPS = 30;

export const initialTranscriptState: TranscriptState = {
  value: '',
  undoStack: [],
  editingStart: null,
};

function withUndoPoint(stack: readonly string[], snapshot: string): readonly string[] {
  if (stack[stack.length - 1] === snapshot) return stack;
  return [...stack.slice(-(MAX_UNDO_STEPS - 1)), snapshot];
}

export function transcriptReducer(state: TranscriptState, action: TranscriptAction): TranscriptState {
  switch (action.type) {
    case 'begin-editing':
      return { ...state, editingStart: state.value };
    case 'change':
      return action.value === state.value ? state : { ...state, value: action.value };
    case 'append-letter': {
      const letter = action.value.toUpperCase();
      if (!/^[A-Z]$/.test(letter) || state.value.length >= 1200) return state;
      return {
        value: `${state.value}${letter}`,
        undoStack: withUndoPoint(state.undoStack, state.value),
        editingStart: null,
      };
    }
    case 'append-space':
      if (!state.value || /\s$/.test(state.value) || state.value.length >= 1200) return state;
      return {
        value: `${state.value} `,
        undoStack: withUndoPoint(state.undoStack, state.value),
        editingStart: null,
      };
    case 'append-word': {
      const word = action.value.trim().replace(/\s+/g, ' ');
      if (!word || state.editingStart !== null) return state;
      const value = `${state.value.trimEnd()}${state.value.trim() ? ' ' : ''}${word}`;
      if (value.length > 1200) return state;
      return { value, undoStack: withUndoPoint(state.undoStack, state.value), editingStart: null };
    }
    case 'backspace':
      if (!state.value) return state;
      return {
        value: state.value.slice(0, -1),
        undoStack: withUndoPoint(state.undoStack, state.value),
        editingStart: null,
      };
    case 'commit-editing': {
      const undoStack = state.editingStart !== null && state.editingStart !== state.value
        ? withUndoPoint(state.undoStack, state.editingStart)
        : state.undoStack;
      return { ...state, undoStack, editingStart: null };
    }
    case 'undo': {
      if (state.undoStack.length === 0) return state;
      const undoStack = state.undoStack.slice(0, -1);
      return { value: state.undoStack[state.undoStack.length - 1], undoStack, editingStart: null };
    }
    case 'clear':
      if (!state.value) return state;
      return {
        value: '',
        undoStack: withUndoPoint(state.undoStack, state.value),
        editingStart: null,
      };
  }
}

export function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
} 

