import React, { act } from 'react';
import { useAslWordRecognizer } from '../../src/recognition/use-asl-word-recognizer';
import { CITIZEN_LABELS as mockCitizenLabels, WLASL_LABELS as mockWlaslLabels } from '../../src/recognition/expanded-vocabulary';
import type { TrackingFrame } from '../../src/recognition/landmarks';

const { JSDOM } = jest.requireActual('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const originalWindow = globalThis.window;
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { createRoot } = jest.requireActual('react-dom/client');
let mockCalls = 0;
let mockWlaslWord = 'water';
let mockMirroredWord = 'HELLO';
let mockCitizenPasses = 0;
let mockSecondPassWait: Promise<void> | null = null;
// Match fast-tflite: output storage is overwritten by the next invocation.
const mockCitizenOutput = new Float32Array(2731);
const mockAppend = jest.fn();
const mockScores = (labels: readonly string[], word: string) => {
  const data = new Float32Array(labels.length).fill(-20); data[labels.indexOf(word)] = 20; return data.buffer;
};
jest.mock('../../assets/models/asl_words_250.tflite', () => 1);
jest.mock('../../assets/models/asl_words_citizen.tflite', () => 2);
jest.mock('../../assets/models/asl_words_2000.tflite', () => 3);
jest.mock('../../assets/models/asl_words_1000.tflite', () => 4);
jest.mock('../../src/recognition/local-model', () => ({ useBundledModel: () => {
  const citizen = mockCalls++ % 2 === 0;
  return { state: 'loaded', model: { inputs: [{ dataType: 'float32', shape: citizen ? [1, 2, 128, 27] : [1, 55, 100] }],
    run: async () => {
      if (!citizen) return [mockScores(mockWlaslLabels, mockWlaslWord)];
      const second = mockCitizenPasses++ % 2 === 1;
      if (second && mockSecondPassWait) await mockSecondPassWait;
      mockCitizenOutput.set(new Float32Array(mockScores(mockCitizenLabels, second ? mockMirroredWord : 'HELLO')));
      return [mockCitizenOutput.buffer];
    } } };
} }));

let current: ReturnType<typeof useAslWordRecognizer>;
function Pilot({ active }: { active: boolean }) {
  current = useAslWordRecognizer(active, 1, mockAppend, 'expanded');
  return null;
}
function frame(timestampMs: number): TrackingFrame {
  const point = (x: number) => ({ x, y: 0.5, z: 0, visibility: 1 });
  const pose = Array.from({ length: 33 }, () => point(0.5));
  pose[11] = point(0.3); pose[12] = point(0.7); pose[15] = point(0.4);
  return { timestampMs, width: 480, height: 640, pose, face: [], blendshapes: {}, inferenceMs: 30,
    hands: [{ side: 'Left', score: 0.99, landmarks: Array.from({ length: 21 }, (_, i) => point(0.4 + i / 1000)) }] };
}

describe('expanded vocabulary accuracy gate', () => {
  let root: { render: (node: React.ReactNode) => void; unmount: () => void };
  let container: HTMLDivElement;
  beforeEach(() => {
    mockCalls = 0; mockWlaslWord = 'water'; mockMirroredWord = 'HELLO'; mockCitizenPasses = 0;
    mockSecondPassWait = null; mockAppend.mockClear();
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

