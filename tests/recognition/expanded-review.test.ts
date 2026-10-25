import React, { act } from 'react';
import { useAslWordRecognizer, type RecognitionLearning } from '../../src/recognition/use-asl-word-recognizer';
import { CITIZEN_LABELS as mockCitizenLabels, WLASL_LABELS as mockWlaslLabels, RECOGNITION_WORD_LABELS, citizenWord, wordKey } from '../../src/recognition/expanded-vocabulary';
import type { TrackingFrame } from '../../src/recognition/landmarks';
import { BASELINE_VERSION, emptyDataset, trainPersonalRanker, type RecognitionCapture } from '../../src/recognition/recognition-examples';

const { JSDOM } = jest.requireActual('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const originalWindow = globalThis.window;
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { createRoot } = jest.requireActual('react-dom/client');
let mockCalls = 0;
let mockWlaslWord = 'water';
let mockOriginalWord = 'HELLO';
let mockMirroredWord = 'HELLO';
let mockCitizenPasses = 0;
let mockSecondPassWait: Promise<void> | null = null;
let mockModelsLoading = false;
let mockInferenceFails = false;
// Match fast-tflite: output storage is overwritten by the next invocation.
const mockCitizenOutput = new Float32Array(2731);
const mockAppend = jest.fn();
const mockScores = (labels: readonly string[], word: string) => {
  const data = new Float32Array(labels.length).fill(word ? -20 : 0);
  if (word) data[labels.indexOf(word)] = 20;
  return data.buffer;
};
jest.mock('../../assets/models/asl_words_250.tflite', () => 1);
jest.mock('../../assets/models/asl_words_citizen.tflite', () => 2);
jest.mock('../../assets/models/asl_words_2000.tflite', () => 3);
jest.mock('../../assets/models/asl_words_1000.tflite', () => 4);
jest.mock('../../src/recognition/local-model', () => ({ useBundledModel: () => {
  const citizen = mockCalls++ % 2 === 0;
  if (mockModelsLoading) return { state: 'loading' };
  return { state: 'loaded', model: { inputs: [{ dataType: 'float32', shape: citizen ? [1, 2, 128, 27] : [1, 55, 100] }],
    run: async () => {
      if (mockInferenceFails) throw new Error('Inference unavailable');
      if (!citizen) return [mockScores(mockWlaslLabels, mockWlaslWord)];
      const second = mockCitizenPasses++ % 2 === 1;
      if (second && mockSecondPassWait) await mockSecondPassWait;
      mockCitizenOutput.set(new Float32Array(mockScores(mockCitizenLabels, second ? mockMirroredWord : mockOriginalWord)));
      return [mockCitizenOutput.buffer];
    } } };
} }));

let current: ReturnType<typeof useAslWordRecognizer>;
let mockLearning: RecognitionLearning | undefined;
function Pilot({ active }: { active: boolean }) {
  current = useAslWordRecognizer(active, 1, mockAppend, mockLearning);
  return null;
}
function frame(timestampMs: number): TrackingFrame {
  const point = (x: number) => ({ x, y: 0.5, z: 0, visibility: 1 });
  const pose = Array.from({ length: 33 }, () => point(0.5));
  pose[11] = point(0.3); pose[12] = point(0.7); pose[15] = point(0.4);
  return { timestampMs, width: 480, height: 640, pose, face: [], blendshapes: {}, inferenceMs: 30,
    hands: [{ side: 'Left', score: 0.99, landmarks: Array.from({ length: 21 }, (_, i) => point(0.4 + i / 1000)) }] };
}

describe('500-word vocabulary review gate', () => {
  let root: { render: (node: React.ReactNode) => void; unmount: () => void };
  let container: HTMLDivElement;
  beforeEach(() => {
    mockCalls = 0; mockWlaslWord = 'water'; mockOriginalWord = 'HELLO'; mockMirroredWord = 'HELLO'; mockCitizenPasses = 0;
    mockSecondPassWait = null; mockAppend.mockClear(); mockLearning = undefined; mockModelsLoading = false; mockInferenceFails = false;
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(React.createElement(Pilot, { active: true })));
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  afterAll(() => { dom.window.close(); Object.assign(globalThis, { window: originalWindow }); });

  async function recognize() {
    act(() => { for (let t = 0; t <= 800; t += 100) current.onFrame(frame(t)); });
    await act(async () => { current.finishSign(); });
  }

  it('captures richer features only for an explicitly armed local example', async () => {
    const onCapture = jest.fn(); mockLearning = { captureToken: 'capture-1', ranker: null, onCapture };
    act(() => root.render(React.createElement(Pilot, { active: true })));
    await recognize();
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture.mock.calls[0][0]).toBe('capture-1');
    const capture = onCapture.mock.calls[0][1];
    expect(capture.sequence.frames).toHaveLength(24);
    expect(capture.diagnostics.frames).toBe(9);
    expect(capture.baseline).toEqual(current.candidates);
    expect(capture.baseline).toHaveLength(3);
    expect(mockAppend).not.toHaveBeenCalled();
    expect(capture.evidence.primary).toContain('HELLO');
    expect(capture.evidence.secondary).toContain('WATER');
  });
  it.each(['loading', 'failed inference'])('keeps a personal recording when pretrained recognition is %s', async (state) => {
    const onCapture = jest.fn(); mockLearning = { captureToken: 'user-defined', ranker: null, onCapture };
    mockModelsLoading = state === 'loading'; mockInferenceFails = state === 'failed inference';
    act(() => root.render(React.createElement(Pilot, { active: true })));
    await recognize();
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture.mock.calls[0][1].baseline).toEqual([]);
    expect(onCapture.mock.calls[0][1].sequence.frames).toHaveLength(24);
    expect(current.candidates).toEqual([]); expect(mockAppend).not.toHaveBeenCalled();
  });

  it('offers and confirms a personally taught word outside the 500-word list without auto-appending', async () => {
    const onCapture = jest.fn(); mockLearning = { captureToken: 'teach', ranker: null, onCapture };
    act(() => root.render(React.createElement(Pilot, { active: true })));
    await recognize();
    const capture: RecognitionCapture = onCapture.mock.calls[0][1];
    const data = { ...emptyDataset(), examples: [0, 1, 2].map((i) => ({ ...capture, id: String(i), label: 'MY NAME', signer: 'me',
      session: 'teaching', split: 'train' as const, createdAt: '2026-10-25', baselineVersion: BASELINE_VERSION })) };
    const ranker = await trainPersonalRanker(data, 'me');
    mockLearning = { captureToken: null, ranker, onCapture };
    act(() => root.render(React.createElement(Pilot, { active: false })));
    act(() => root.render(React.createElement(Pilot, { active: true })));
    await recognize();
    expect(current.candidates[0]).toBe('MY NAME'); expect(current.candidates).toHaveLength(3);
    expect(RECOGNITION_WORD_LABELS).not.toContain('MY NAME'); expect(mockAppend).not.toHaveBeenCalled();
    act(() => current.chooseCandidate('MY NAME'));
    expect(mockAppend).toHaveBeenCalledWith('MY NAME');
  });

  it('does not assign an in-flight result to a canceled or replacement collection request', async () => {
    const onCapture = jest.fn(); mockLearning = { captureToken: 'capture-1', ranker: null, onCapture };
    act(() => root.render(React.createElement(Pilot, { active: true })));
    let release!: () => void; mockSecondPassWait = new Promise<void>((resolve) => { release = resolve; });
    await recognize();
    mockLearning = { captureToken: 'capture-2', ranker: null, onCapture };
    act(() => root.render(React.createElement(Pilot, { active: true })));
    await act(async () => { release(); });
    expect(onCapture).not.toHaveBeenCalled();
    expect(current.candidates).toHaveLength(3);
  });

  it('never auto-appends conflicting predictions, but lets the user confirm one once', async () => {
    await recognize();
    expect(current.candidates).toHaveLength(3);
    expect(current.candidates[0]).toBe('HELLO');
    expect(mockAppend).not.toHaveBeenCalled();
    act(() => { current.chooseCandidate('HELLO'); current.chooseCandidate('HELLO'); });
    expect(mockAppend).toHaveBeenCalledWith('HELLO');
    expect(current.candidates).toEqual([]);
    act(() => current.chooseCandidate('HELLO'));
    expect(mockAppend).toHaveBeenCalledTimes(1);
  });

  it('requires review even for apparent strong agreement until live accuracy is validated', async () => {
    mockWlaslWord = 'hello';
    await recognize();
    expect(current.candidates).toHaveLength(3);
    expect(current.candidates[0]).toBe('HELLO');
    expect(mockAppend).not.toHaveBeenCalled();
    expect(mockCitizenPasses).toBe(2);
  });

  it('offers three permitted alternatives for an excluded leader without adding it to the transcript', async () => {
    const allowed = new Set(RECOGNITION_WORD_LABELS.map(wordKey));
    mockOriginalWord = mockCitizenLabels.find((label) => !allowed.has(citizenWord(label)))!;
    mockMirroredWord = mockOriginalWord;
    await recognize();
    expect(current.candidates).toHaveLength(3);
    expect(new Set(current.candidates).size).toBe(3);
    expect(current.candidates.every((label) => allowed.has(wordKey(label)))).toBe(true);
    expect(current.candidates).not.toContain(mockOriginalWord);
    act(() => current.chooseCandidate(mockOriginalWord));
    expect(mockAppend).not.toHaveBeenCalled();
    expect(current.processing).toBe(false);
  });

  it('offers three choices for flat low scores and adds only the user-selected word', async () => {
    mockOriginalWord = ''; mockMirroredWord = ''; mockWlaslWord = '';
    await recognize();
    expect(current.candidates).toHaveLength(3);
    expect(new Set(current.candidates).size).toBe(3);
    expect(mockAppend).not.toHaveBeenCalled();
    const choice = current.candidates[1];
    act(() => current.chooseCandidate(choice));
    expect(mockAppend).toHaveBeenCalledTimes(1);
    expect(mockAppend).toHaveBeenCalledWith(choice);
    expect(current.candidates).toEqual([]);
  });

  it('preserves both native outputs and offers distinct choices when views disagree', async () => {
    mockMirroredWord = 'WATER';
    await recognize();
    expect(current.candidates).toHaveLength(3);
    expect(current.candidates).toEqual(expect.arrayContaining(['HELLO', 'WATER']));
    expect(new Set(current.candidates).size).toBe(3);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('discards a second-pass result completed after the camera stops', async () => {
    let release!: () => void;
    mockSecondPassWait = new Promise<void>((resolve) => { release = resolve; });
    await recognize();
    expect(mockCitizenPasses).toBe(2);
    act(() => root.render(React.createElement(Pilot, { active: false })));
    await act(async () => { release(); });
    expect(current.candidates).toEqual([]);
    expect(current.processing).toBe(false);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('rejects stale candidate selection after the session stops', async () => {
    await recognize();
    act(() => root.render(React.createElement(Pilot, { active: false })));
    act(() => current.chooseCandidate('HELLO'));
    expect(mockAppend).not.toHaveBeenCalled();
    expect(current.candidates).toEqual([]);
  });

  it('automatically recognizes the next sign without selecting or retrying', async () => {
    await recognize();
    expect(current.candidates).toHaveLength(3);
    await act(async () => {
      for (let t = 900; t <= 1500; t += 100) current.onFrame({ ...frame(t), hands: [] });
      for (let t = 1600; t <= 2400; t += 100) current.onFrame(frame(t));
      current.finishSign();
    });
    expect(mockCitizenPasses).toBe(4);
    expect(current.candidates).toHaveLength(3);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('does not capture control taps and gestures during inference', async () => {
    let release!: () => void;
    mockSecondPassWait = new Promise<void>((resolve) => { release = resolve; });
    await recognize();
    act(() => {
      for (let t = 900; t <= 5000; t += 100) current.onFrame({ ...frame(t), hands: t < 1600 ? [] : frame(t).hands });
    });
    await act(async () => release());
    act(() => current.chooseCandidate('HELLO'));
    await act(async () => { current.onFrame(frame(5100)); current.finishSign(); });
    expect(mockCitizenPasses).toBe(2);
    expect(mockAppend).toHaveBeenCalledTimes(1);
  });
}); 

