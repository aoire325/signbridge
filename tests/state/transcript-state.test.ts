import {
  countWords,
  initialTranscriptState,
  transcriptReducer,
} from '../../src/state/transcript-state';

describe('transcript reducer', () => {
  it('groups a text edit into one undo step', () => {
    let state = transcriptReducer(initialTranscriptState, { type: 'begin-editing' });
    state = transcriptReducer(state, { type: 'change', value: 'Hello' });
    state = transcriptReducer(state, { type: 'change', value: 'Hello there' });
    state = transcriptReducer(state, { type: 'commit-editing' });

    expect(state.value).toBe('Hello there');
    expect(state.undoStack).toEqual(['']);
    expect(transcriptReducer(state, { type: 'undo' }).value).toBe('');
  });

  it('restores cleared transcript text with undo', () => {
    const filledState = { ...initialTranscriptState, value: 'Please help me.' };
    const clearedState = transcriptReducer(filledState, { type: 'clear' });

    expect(clearedState.value).toBe('');
    expect(transcriptReducer(clearedState, { type: 'undo' }).value).toBe('Please help me.');
  });

  it('counts words without treating repeated whitespace as words', () => {
    expect(countWords('  I   need help  ')).toBe(3);
    expect(countWords('   ')).toBe(0);
  });

  it('adds a confirmed word with spacing and one undo step', () => {
    const start = { ...initialTranscriptState, value: 'HELLO ' };
    const next = transcriptReducer(start, { type: 'append-word', value: ' FRIEND ' });
    expect(next.value).toBe('HELLO FRIEND');
    expect(transcriptReducer(next, { type: 'undo' }).value).toBe('HELLO ');
  });

  it('does not insert a match into an active edit or exceed the transcript limit', () => {
    const editing = { ...initialTranscriptState, editingStart: '' };
    expect(transcriptReducer(editing, { type: 'append-word', value: 'HELLO' })).toBe(editing);
    const full = { ...initialTranscriptState, value: 'A'.repeat(1198) };
    expect(transcriptReducer(full, { type: 'append-word', value: 'HELLO' })).toBe(full);
  });
}); 

